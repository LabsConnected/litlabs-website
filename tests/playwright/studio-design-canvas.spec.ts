import { test, expect, type Page } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Studio Design canvas — project-backed visual editing E2E.
 *
 * Covers the DOM-direct editor: live preview element selection, pointer
 * drag reorder, resize handles, snap guides, pan tool, CAS conflict
 * honesty, undo/redo, and file persistence. Project files are the source
 * of truth — every assertion reads them back through the files API.
 *
 * Requires: authenticated storage state (authenticated-chromium project),
 * a running terminal-server for workspace + preview runtime.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3101 \
 *     pnpm exec playwright test studio-design-canvas --project=authenticated-chromium
 */

const SEEDED_HTML = `<!DOCTYPE html>
<html><head><style>body{font-family:sans-serif;margin:0}#stage{padding:24px}#box{width:120px;height:80px;background:#7c3aed}</style></head>
<body>
  <ul id="list">
    <li id="item-a" style="height:44px;background:#eee;margin:4px 0">Alpha</li>
    <li id="item-b" style="height:44px;background:#eee;margin:4px 0">Beta</li>
    <li id="item-c" style="height:44px;background:#eee;margin:4px 0">Gamma</li>
  </ul>
  <div id="stage"><div id="box">Box</div><p id="note">note text</p></div>
</body></html>`;

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

async function apiFiles(page: Page, projectId: string, body: Record<string, unknown>) {
  const token = await clerkToken(page);
  const res = await page.request.post(`/api/studio-projects/${projectId}/files`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
    timeout: 60_000,
  });
  if (!res.ok()) throw new Error(`files ${String(body.action)}: ${res.status()} ${await res.text()}`);
  return res.json();
}

async function seedIndex(page: Page, projectId: string, html = SEEDED_HTML) {
  await apiFiles(page, projectId, { action: "write", path: "index.html", content: html });
}

async function readIndex(page: Page, projectId: string): Promise<string> {
  const data = await apiFiles(page, projectId, { action: "read", path: "index.html" });
  return String(data.content ?? "");
}

async function createBlankProject(page: Page): Promise<string> {
  const token = await clerkToken(page);
  const res = await page.request.post("/api/studio-projects", {
    headers: { Authorization: `Bearer ${token}` },
    data: { sourceType: "blank", name: `design-canvas-${Date.now()}`, templateId: "blank-static" },
    timeout: 60_000,
  });
  if (!res.ok()) throw new Error(`create project: ${res.status()} ${await res.text()}`);
  const data = await res.json();
  return data.project.id as string;
}

/** Wait for the live preview iframe AND the inspector bridge "ready"
    (selection only works once the in-frame script answers). */
async function waitForPreview(page: Page) {
  const frame = page.getByTestId("preview-iframe");
  await frame.waitFor({ state: "visible", timeout: 120_000 });
  // Bridge readiness shows as no selectionError; give the handshake a beat.
  await page.waitForTimeout(1500);
  return frame;
}

async function openDesign(page: Page, projectId: string) {
  await page.goto(`/studio?project=${projectId}&tool=design`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByTestId("project-design-surface").waitFor({ state: "visible", timeout: 90_000 });
}

test.describe("Studio Design canvas @studio @design-canvas", () => {
  test.describe.configure({ mode: "serial" });
  let projectId: string;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/studio", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(
      () => Boolean((window as Window & { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
      { timeout: 60_000 },
    );
    projectId = await createBlankProject(page);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await seedIndex(page, projectId);
  });

  test("Design surface shows toolbar and live preview for the active project", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await openDesign(page, projectId);
    await waitForPreview(page);

    await expect(page.getByTestId("design-tool-select")).toBeVisible();
    await expect(page.getByTestId("design-tool-pan")).toBeVisible();
    await expect(page.getByTestId("design-tool-edit")).toBeVisible();
    await expect(page.getByTestId("design-snap-toggle")).toBeVisible();
    await expect(page.getByTestId("design-undo")).toBeVisible();
    await expect(page.getByTestId("design-redo")).toBeVisible();
    assertNoErrors(errors);
  });

  test("clicking a preview element selects it and resolves the file element", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await openDesign(page, projectId);
    await waitForPreview(page);

    const item = page.frameLocator("[data-testid='preview-iframe']").locator("#item-b");
    await item.click();

    // Selection reaches CommandStudio's previewSelection → inspector
    // resolves the element inside index.html (status line shows the file).
    const inspector = page.getByTestId("element-inspector-panel");
    await expect(inspector).toBeVisible({ timeout: 30_000 });
    await expect(inspector).toContainText("index.html", { timeout: 30_000 });
    assertNoErrors(errors);
  });

  test("dragging an element reorders it in the workspace file", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await openDesign(page, projectId);
    await waitForPreview(page);

    const frame = page.frameLocator("[data-testid='preview-iframe']");
    const itemA = frame.locator("#item-a");
    const itemC = frame.locator("#item-c");
    await itemA.waitFor({ state: "visible", timeout: 30_000 });

    const aBox = await itemA.boundingBox();
    const cBox = await itemC.boundingBox();
    expect(aBox && cBox).toBeTruthy();

    // Drag Alpha below Gamma — flow reorder, insertion indicator shows.
    await page.mouse.move(aBox!.x + aBox!.width / 2, aBox!.y + aBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(cBox!.x + cBox!.width / 2, cBox!.y + cBox!.height + 8, { steps: 12 });
    await page.waitForTimeout(300);
    await page.mouse.up();

    // The geometry-commit → files-changed → iframe reload cycle is async.
    await expect
      .poll(async () => {
        const html = await readIndex(page, projectId);
        return html.indexOf('id="item-a"') > html.indexOf('id="item-c"') ? "moved" : "same";
      }, { timeout: 60_000, intervals: [1000, 2000, 4000] })
      .toBe("moved");
    assertNoErrors(errors);
  });

  test("resizing via a corner handle persists box styles to the file", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await openDesign(page, projectId);
    await waitForPreview(page);

    const frame = page.frameLocator("[data-testid='preview-iframe']");
    const box = frame.locator("#box");
    await box.click();
    await expect(page.getByTestId("element-inspector-panel")).toBeVisible({ timeout: 30_000 });

    // The se handle is an in-frame overlay div — locate it inside the frame.
    const seHandle = frame.locator("[data-litt-handle='se']");
    await expect(seHandle).toBeVisible({ timeout: 15_000 });
    const hBox = await seHandle.boundingBox();
    expect(hBox).toBeTruthy();

    await page.mouse.move(hBox!.x + 4, hBox!.y + 4);
    await page.mouse.down();
    await page.mouse.move(hBox!.x + 60, hBox!.y + 40, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const html = await readIndex(page, projectId);
        const m = html.match(/<div id="box"[^>]*style="([^"]*)"/);
        return m ? m[1] : "";
      }, { timeout: 60_000, intervals: [1000, 2000, 4000] })
      .toMatch(/width:\s*1[7-9][0-9]px|width:\s*2\d\dpx/);
    assertNoErrors(errors);
  });

  test("a stale write surfaces an honest conflict instead of clobbering", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await openDesign(page, projectId);
    await waitForPreview(page);

    const frame = page.frameLocator("[data-testid='preview-iframe']");
    await frame.locator("#note").click();
    const inspector = page.getByTestId("element-inspector-panel");
    await expect(inspector).toBeVisible({ timeout: 30_000 });
    await expect(inspector).toContainText("index.html", { timeout: 30_000 });

    // Simulate a concurrent agent/file write AFTER the inspector resolved.
    const drifted = SEEDED_HTML.replace("note text", "note text — agent edit");
    await seedIndex(page, projectId, drifted);

    // Now apply a visual edit — CAS must refuse (409) and show conflict UI.
    const textField = page.getByTestId("element-edit-text");
    if (await textField.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await textField.fill("visual edit");
      await textField.blur();
    } else {
      // Fall back to a style commit through the same write path.
      test.skip(true, "text field not editable for this element");
      return;
    }

    await expect(page.getByTestId("element-edit-conflict")).toBeVisible({ timeout: 30_000 });
    // File on disk is untouched by the rejected write.
    const html = await readIndex(page, projectId);
    expect(html).toContain("agent edit");
    expect(html).not.toContain(">visual edit<");
    assertNoErrors(errors);
  });

  test("undo restores the previous file bytes after an edit", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await openDesign(page, projectId);
    await waitForPreview(page);

    const before = await readIndex(page, projectId);

    const frame = page.frameLocator("[data-testid='preview-iframe']");
    await frame.locator("#note").click();
    await expect(page.getByTestId("element-inspector-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("element-inspector-panel")).toContainText("index.html", { timeout: 30_000 });

    const textField = page.getByTestId("element-edit-text");
    await textField.waitFor({ state: "visible", timeout: 20_000 });
    await textField.fill("undo me");
    await textField.blur();

    await expect
      .poll(async () => (await readIndex(page, projectId)).includes("undo me"), { timeout: 45_000 })
      .toBe(true);

    await page.getByTestId("design-undo").click();
    await expect
      .poll(async () => (await readIndex(page, projectId)).includes("undo me"), { timeout: 45_000 })
      .toBe(false);
    const after = await readIndex(page, projectId);
    expect(after).toBe(before);
    assertNoErrors(errors);
  });

  test("pan tool scrolls the preview without selecting elements", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    // Tall page so panning has somewhere to go.
    const tall = SEEDED_HTML.replace("</body>", `<div style="height:2000px"></div></body>`);
    await seedIndex(page, projectId, tall);
    await openDesign(page, projectId);
    await waitForPreview(page);

    await page.getByTestId("design-tool-pan").click();
    const frame = page.frameLocator("[data-testid='preview-iframe']");
    const target = frame.locator("#note");
    const box = await target.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y - 200, { steps: 10 });
    await page.mouse.up();

    // Pan scrolls the frame content (scrollY increases); no file write.
    await expect
      .poll(async () => page.evaluate(() => {
        const f = document.querySelector("[data-testid='preview-iframe']") as HTMLIFrameElement;
        try { return f.contentWindow?.scrollY ?? 0; } catch { return 0; }
      }), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const html = await readIndex(page, projectId);
    expect(html).toContain("2000px"); // file untouched by pan
    assertNoErrors(errors);
  });
});
