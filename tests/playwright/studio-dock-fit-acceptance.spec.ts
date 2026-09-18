import { test, expect, type Page } from "@playwright/test";

/**
 * REAL browser acceptance for the terminal fit/resize fix.
 *
 * Drives the actual Studio UI with a live PTY session (local terminal-server
 * on :4011) across viewport sizes. Verifies:
 *   - xterm fits its real container (no clipped bottom row / right edge)
 *   - PTY cols/rows match the rendered xterm dimensions
 *   - no horizontal page/terminal scrolling
 *   - header/status content wraps or truncates, never clips
 *   - composer stays fully visible
 *   - dock resize, tab hide→show, maximize/restore, viewport shrink→grow→shrink
 *
 * bypassCSP is used ONLY because local dev CSP whitelists the dev terminal
 * port (:4001) while this test stack runs the terminal-server on :4011.
 * The CSP itself is not under test.
 *
 * Requires a live stack: Next dev server + terminal-server + Clerk test
 * auth. Filename avoids `terminal` so public-chromium's testMatch doesn't
 * pick it up; it matches only authenticated-chromium (not run in CI).
 * Opt in explicitly with PLAYWRIGHT_TERMINAL_ACCEPTANCE=1:
 *   PLAYWRIGHT_TERMINAL_ACCEPTANCE=1 PLAYWRIGHT_BASE_URL=http://localhost:3011 \
 *     npx playwright test studio-dock-fit-acceptance --project=authenticated-chromium --no-deps
 */
test.use({ bypassCSP: true });
test.skip(
  !process.env.PLAYWRIGHT_TERMINAL_ACCEPTANCE,
  "requires live terminal-server + auth stack; set PLAYWRIGHT_TERMINAL_ACCEPTANCE=1",
);

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 900 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const TERM = ".xterm";

async function clerkToken(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const clerk = (window as unknown as {
      Clerk?: { session?: { getToken?: () => Promise<string | null> } };
    }).Clerk;
    const t = await clerk?.session?.getToken?.();
    if (!t) throw new Error("no clerk session token");
    return t;
  });
}

async function createBlankProject(page: Page): Promise<string> {
  const token = await clerkToken(page);
  const res = await page.request.post("/api/studio-projects", {
    headers: { Authorization: `Bearer ${token}` },
    data: { sourceType: "blank", name: `termfit-${Date.now()}`, templateId: "blank-static" },
    timeout: 60_000,
  });
  if (!res.ok()) throw new Error(`create project: ${res.status()} ${await res.text()}`);
  const data = await res.json();
  return data.project.id as string;
}

/** Wait until xterm exists AND the PTY session reports connected. */
async function waitForLiveTerminal(page: Page): Promise<void> {
  await page.locator(TERM).waitFor({ state: "attached", timeout: 60_000 });
  // The dock status pill flips to "Connected" when session:ready fires.
  await expect(page.getByTestId("studio-dock")).toContainText("Connected", {
    timeout: 90_000,
  });
  // And the shell has rendered a prompt.
  await expect
    .poll(
      async () => (await page.locator(".xterm-rows").innerText()).trim().length,
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBeGreaterThan(0);
}

interface TermGeometry {
  renderedRows: number;
  renderedCols: number;
  mountRight: number;
  mountBottom: number;
  lastRowBottom: number;
  rightmostCellRight: number;
}

/**
 * Read live terminal geometry from the DOM.
 * renderedRows = number of row divs (xterm renders exactly `rows` divs).
 * renderedCols = .xterm-screen width / measured cell width.
 */
async function measureTerminal(page: Page): Promise<TermGeometry> {
  return page.evaluate(() => {
    const xterm = document.querySelector(".xterm") as HTMLElement | null;
    const mount = xterm?.parentElement;
    const screen = document.querySelector(".xterm-screen") as HTMLElement | null;
    const rows = [...document.querySelectorAll(".xterm-rows > div")] as HTMLElement[];
    if (!mount || !screen || rows.length === 0) throw new Error("terminal not mounted");
    const m = mount.getBoundingClientRect();
    const spans = rows.flatMap((r) => [...r.querySelectorAll("span")]);
    // Measure cell width from an ASCII-only span — wide glyphs (emoji,
    // box-drawing) and surrogate pairs distort per-character division.
    const span =
      spans.find((s) => /^[\x20-\x7e]{2,}$/.test(s.textContent ?? "")) ??
      spans.find((s) => (s.textContent ?? "").trim().length > 0);
    const units = span ? [...(span.textContent ?? "")].length : 0;
    const cellW = span && units > 0 ? span.getBoundingClientRect().width / units : 0;
    const renderedCols =
      cellW > 0 ? Math.round(screen.getBoundingClientRect().width / cellW) : -1;
    let rightmost = 0;
    for (const s of spans) {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.right > rightmost) rightmost = r.right;
    }
    return {
      renderedRows: rows.length,
      renderedCols,
      mountRight: m.right,
      mountBottom: m.bottom,
      lastRowBottom: rows[rows.length - 1].getBoundingClientRect().bottom,
      rightmostCellRight: rightmost,
    };
  });
}

/**
 * terminal:resize frames the client sent over socket.io. The server applies
 * these verbatim to the PTY (ptyManager.resize), so the last emitted dims
 * are the live PTY dims — verified without typing into the terminal.
 */
const resizeEvents: { cols: number; rows: number }[] = [];

function sniffResizeFrames(page: Page): void {
  page.on("websocket", (ws) => {
    if (!ws.url().includes("socket.io")) return;
    ws.on("framesent", (frame) => {
      const payload = frame.payload;
      if (typeof payload !== "string") return;
      const idx = payload.indexOf("[");
      if (idx < 0) return;
      try {
        const arr = JSON.parse(payload.slice(idx)) as unknown[];
        if (arr[0] === "terminal:resize" && arr[1] && typeof arr[1] === "object") {
          const d = arr[1] as { cols?: number; rows?: number };
          if (typeof d.cols === "number" && typeof d.rows === "number") {
            resizeEvents.push({ cols: d.cols, rows: d.rows });
          }
        }
      } catch {
        /* non-JSON frame */
      }
    });
  });
}

interface Checks {
  pageHScroll: boolean;
  composerVisible: boolean;
  bottomRowVisible: boolean;
  rightEdgeVisible: boolean;
  chipsInside: boolean;
  pty: { ok: boolean; detail: string };
}

async function runViewportChecks(page: Page, label: string): Promise<Checks> {
  // Let RO + rAF-coalesced fit settle.
  await page.waitForTimeout(600);

  const pageHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );

  // Composer must be fully inside the viewport when it is rendered. On
  // narrow/mobile layouts the composer lives inside the LiTT panel by
  // design — record its state without failing.
  const composer = page.getByTestId("studio-command-composer");
  const composerVisible = (await composer.count()) === 0
    ? true
    : await composer
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return true;
          return r.bottom <= window.innerHeight + 1 && r.top >= 0 && r.right <= window.innerWidth + 1;
        })
        .catch(() => false);

  const termAttached = (await page.locator(TERM).count()) > 0;
  let bottomRowVisible = true;
  let rightEdgeVisible = true;
  let pty = { ok: true, detail: "no xterm mounted" };
  if (termAttached) {
    const g = await measureTerminal(page);
    bottomRowVisible = g.lastRowBottom <= g.mountBottom + 1;
    rightEdgeVisible = g.rightmostCellRight <= g.mountRight + 1;
    const last = resizeEvents[resizeEvents.length - 1];
    pty = last
      ? {
          ok: last.rows === g.renderedRows && last.cols === g.renderedCols,
          detail: `emitted=${last.rows}x${last.cols} rendered=${g.renderedRows}x${g.renderedCols}`,
        }
      : { ok: false, detail: "no terminal:resize frames captured" };
  }

  // Status/header content must stay inside the dock horizontally. An
  // element counts as "sticking out" only if it visually extends past the
  // dock edge — i.e. no ancestor up to the dock clips it (overflow-x
  // hidden/scroll/auto) — since scrollable tab strips and
  // ellipsis-truncated text are legitimate containment, not clipping.
  const { chipsInside, offenders } = await page.evaluate(() => {
    const dock = document.querySelector('[data-testid="studio-dock"]');
    if (!dock) return { chipsInside: true, offenders: [] as string[] };
    const dr = dock.getBoundingClientRect();
    const bad: string[] = [];
    for (const el of dock.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.right <= dr.right + 2) continue;
      // Walk ancestors to the dock — if any clips horizontally, the
      // element is contained (scrolled or truncated), not sticking out.
      let clipped = false;
      for (let p = el.parentElement; p && p !== dock; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "hidden" || ox === "scroll" || ox === "auto" || ox === "clip") {
          clipped = true;
          break;
        }
      }
      if (!clipped) {
        bad.push(
          `${el.tagName.toLowerCase()}.${(el.className as string).toString().split(" ").slice(0, 3).join(".")} "${(el.textContent ?? "").trim().slice(0, 40)}" right=${Math.round(r.right)} dockRight=${Math.round(dr.right)}`,
        );
      }
    }
    return { chipsInside: bad.length === 0, offenders: bad.slice(0, 5) };
  });
  if (!chipsInside) console.log("[chips-overflow]", offenders);

  const checks: Checks = {
    pageHScroll,
    composerVisible,
    bottomRowVisible,
    rightEdgeVisible,
    chipsInside,
    pty,
  };
  console.log(`[${label}]`, JSON.stringify(checks));
  return checks;
}

function assertChecks(c: Checks, label: string) {
  expect(c.pageHScroll, `${label}: horizontal page scroll`).toBe(false);
  expect(c.composerVisible, `${label}: composer not fully visible`).toBe(true);
  expect(c.bottomRowVisible, `${label}: bottom terminal row clipped`).toBe(true);
  expect(c.rightEdgeVisible, `${label}: right terminal edge clipped`).toBe(true);
  expect(c.chipsInside, `${label}: status/header content clipped`).toBe(true);
  expect(c.pty.ok, `${label}: PTY dims mismatch — ${c.pty.detail}`).toBe(true);
}

test.describe("Terminal fit — real browser acceptance", () => {
  test.describe.configure({ mode: "serial", timeout: 300_000 });

  test("live PTY session fits container across viewports", async ({ page }) => {
    test.setTimeout(300_000);

    // Capture console + network failures for the terminal connect path.
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") {
        console.log(`[browser:${m.type()}]`, m.text().slice(0, 300));
      }
    });
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
    page.on("requestfailed", (r) =>
      console.log("[reqfail]", r.url().slice(0, 160), r.failure()?.errorText),
    );
    page.on("response", (r) => {
      if (r.url().includes("terminal") && r.status() >= 400) {
        console.log("[terminal-resp]", r.status(), r.url().slice(0, 160));
      }
    });
    resizeEvents.length = 0;
    sniffResizeFrames(page);

    // ── Setup: project + studio + live PTY ──────────────────────────────
    await page.goto("/studio", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(
      () => Boolean((window as Window & { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
      { timeout: 60_000 },
    );
    // Cookie consent banner overlays the bottom of the screen and intercepts
    // dock clicks — dismiss it before interacting with the dock.
    const cookies = page.getByRole("button", { name: /essential only/i });
    if (await cookies.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await cookies.click();
    }
    const projectId = await createBlankProject(page);

    // Seed the persisted dock-open flag so the dock mounts expanded on the
    // terminal tab (?tool=terminal → initial.openDrawer="terminal" →
    // dockTab="terminal"; stored open flag → dockOpen=true → view="normal").
    // ?project=<id> explicitly binds the project (deterministic — no reliance
    // on localStorage active-project propagation). litt:terminalAutoStart
    // makes the drawer auto-start the PTY once the workspace is ready.
    await page.evaluate(() => {
      sessionStorage.setItem("studio-dock-open", "true");
      localStorage.setItem("litt:terminalAutoStart", "1");
    });
    await page.goto(`/studio?project=${projectId}&tool=terminal`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    // Wait for the dock to mount (dev-mode compile can be slow on first hit).
    await page.getByTestId("studio-dock").waitFor({ state: "attached", timeout: 90_000 });
    // If the dock still mounts collapsed, expand it via the collapsed toggle.
    const terminalTab = page.getByTestId("dock-tab-terminal");
    if (!(await terminalTab.isVisible({ timeout: 15_000 }).catch(() => false))) {
      const toggle = page.getByTestId("dock-collapsed-toggle");
      if (await toggle.isVisible().catch(() => false)) await toggle.click();
    }
    await terminalTab.click({ timeout: 30_000 });
    // Auto-start handles the connect; if it didn't fire (e.g. flag lost),
    // click Start Terminal as a fallback once it appears.
    const startBtn = page.getByRole("button", { name: /start terminal/i });
    try {
      await startBtn.waitFor({ state: "visible", timeout: 45_000 });
      await startBtn.click();
    } catch {
      // No start button — session may already be connecting/connected.
    }
    await waitForLiveTerminal(page);

    // ── Viewport sweep ─────────────────────────────────────────────────
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const checks = await runViewportChecks(page, vp.name);
      assertChecks(checks, vp.name);
    }

    // ── Dock tab hidden → visible refit ────────────────────────────────
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByTestId("dock-tab-activity").click();
    await page.waitForTimeout(400);
    await page.getByTestId("dock-tab-terminal").click();
    assertChecks(await runViewportChecks(page, "tab-hide-show"), "tab-hide-show");

    // ── Dock drag resize: larger → smaller ─────────────────────────────
    const handle = page.locator('[aria-label="Drag to resize dock"]');
    const hb = await handle.boundingBox();
    if (hb) {
      const cx = hb.x + hb.width / 2;
      const cy = hb.y + hb.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 120, { steps: 6 });
      await page.mouse.up();
      assertChecks(await runViewportChecks(page, "dock-larger"), "dock-larger");
      await page.mouse.move(cx, cy - 120);
      await page.mouse.down();
      await page.mouse.move(cx, cy, { steps: 6 });
      await page.mouse.up();
      assertChecks(await runViewportChecks(page, "dock-smaller"), "dock-smaller");
    }

    // ── Maximize → restore ─────────────────────────────────────────────
    const maxBtn = page.locator('[aria-label="Maximize"]');
    if (await maxBtn.isVisible().catch(() => false)) {
      await maxBtn.click();
      assertChecks(await runViewportChecks(page, "maximized"), "maximized");
      await page.locator('[aria-label="Restore"]').click();
      assertChecks(await runViewportChecks(page, "restored"), "restored");
    }

    // ── Viewport shrink → grow → shrink (mobile keyboard analog) ───────
    await page.setViewportSize({ width: 390, height: 844 });
    await runViewportChecks(page, "mobile-full");
    await page.setViewportSize({ width: 390, height: 460 });
    assertChecks(await runViewportChecks(page, "mobile-keyboard"), "mobile-keyboard");
    await page.setViewportSize({ width: 390, height: 844 });
    assertChecks(await runViewportChecks(page, "mobile-restored"), "mobile-restored");
  });
});
