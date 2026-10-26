import { existsSync } from "fs";
import path from "path";
import { test, expect, E2E_GATES } from "./fixtures";
import type { Page, BrowserContext, APIRequestContext } from "@playwright/test";

/**
 * Isolated E2E — Studio Visual Canvas Builder + canvas-file synchronization.
 *
 * Gates (all fail-safe):
 * - Every suite skips unless E2E_STACK_READY=true (isolated Supabase up,
 *   e2e/env.e2e populated, server env allowlist verified).
 * - Authenticated suites additionally require the `e2e-authenticated` project
 *   and a real Clerk dev-instance storage state produced by auth.setup.ts.
 *   No fabricated sessions, no middleware auth bypass.
 *
 * App-behavior notes verified against commit 2321394:
 * - `/studio?tool=design` mounts VisualCanvasBuilder. With NO active project it
 *   renders the full builder (CanvasToolbar/CanvasStage). With `?project=<id>`
 *   it renders ProjectDesignSurface instead — the editing UI is not shown.
 * - `useCanvasFileSync` is a hook on VisualCanvasBuilder: it runs in BOTH
 *   branches. With a projectId it reads `.litt/canvas.json` (server-wins on
 *   load) and debounce-writes the canvas document (1.2 s) when it differs.
 * - Canvas persistence file: `.litt/canvas.json` via
 *   POST /api/studio-projects/{id}/files {action:"read"|"write"} — that route
 *   proxies to the terminal-server workspace backend, so file-sync coverage
 *   additionally requires an E2E-scoped terminal-server.
 * - The toolbar save-state label ("saved"/"error"/…) is only rendered in the
 *   project-less builder; in project mode save failures are asserted at the
 *   API level (no false persistence) rather than via UI text.
 */

const CANVAS_FILE = ".litt/canvas.json";
const DOC_STORAGE_KEY = "litt:canvasBuilder:document";
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";

const AUTH_STATE = process.env.E2E_AUTH_STATE
  ? path.resolve(process.env.E2E_AUTH_STATE)
  : path.join(__dirname, ".clerk", "user-e2e.json");

function authReady(): boolean {
  return existsSync(AUTH_STATE);
}

function skipUnlessStack() {
  test.skip(
    !E2E_GATES.stackReady,
    "isolated stack not declared ready — set E2E_STACK_READY=true after Checkpoint 2 verifies Supabase/env isolation",
  );
}

function skipUnlessAuthedProject() {
  const project = test.info().project.name;
  test.skip(
    project !== "e2e-authenticated",
    `requires the e2e-authenticated project (current: ${project})`,
  );
  test.skip(
    !authReady(),
    "no verified Clerk dev storage state — auth.setup.ts must run first (E2E_CLERK_AUTH=true)",
  );
}

/** Minimal valid CanvasDocument containing one section + one text node. */
function seedCanvasDocument(text: string, updatedAt = Date.now()) {
  return {
    id: "e2e-canvas-doc",
    projectId: null,
    conversationId: null,
    route: "/",
    nodes: {
      "e2e-root": {
        id: "e2e-root",
        type: "section",
        parentId: null,
        children: ["e2e-text-1"],
        props: {},
        styles: {},
        metadata: { createdAt: updatedAt, updatedAt },
      },
      "e2e-text-1": {
        id: "e2e-text-1",
        type: "text",
        parentId: "e2e-root",
        children: [],
        props: { text },
        styles: {},
        metadata: { createdAt: updatedAt, updatedAt },
      },
    },
    rootNodeIds: ["e2e-root"],
    version: 1,
    updatedAt,
  };
}

async function seedCanvasStorage(page: Page, text: string, updatedAt = Date.now()) {
  await page.addInitScript(
    ({ key, doc }) => window.localStorage.setItem(key, JSON.stringify(doc)),
    { key: DOC_STORAGE_KEY, doc: seedCanvasDocument(text, updatedAt) },
  );
}

/**
 * Mint a fresh Bearer token from the page's LIVE Clerk session. Dev-instance
 * session JWTs expire in ~60s; the storage-state __session cookie goes stale
 * for APIRequestContext calls, so fixture calls authenticate with a just-minted
 * token instead. Requires the page to be on an authed route (Clerk loaded).
 */
async function freshAuthHeader(page: Page): Promise<Record<string, string>> {
  await page.waitForFunction(
    () => {
      const clerk = (
        window as Window & { Clerk?: { loaded?: boolean; session?: unknown } }
      ).Clerk;
      return Boolean(clerk?.loaded && clerk?.session);
    },
    undefined,
    { timeout: 30_000 },
  );
  const token = await page.evaluate(async () => {
    const clerk = (
      window as Window & {
        Clerk?: { session?: { getToken?: (o?: { skipCache?: boolean }) => Promise<string | null> } };
      }
    ).Clerk;
    return clerk?.session?.getToken ? clerk.session.getToken({ skipCache: true }) : null;
  });
  expect(token, "fresh Clerk session token required for fixture API calls").toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

async function createDisposableProject(request: APIRequestContext, page: Page): Promise<string> {
  const resp = await request.post(`${BASE}/api/studio-projects`, {
    headers: await freshAuthHeader(page),
    data: {
      sourceType: "managed",
      name: `e2e-canvas-${Date.now()}`,
      templateId: "blank-static",
    },
  });
  expect(resp.status(), `project create should succeed, got ${resp.status()}`).toBe(201);
  const body = (await resp.json()) as { project?: { id?: string } };
  const id = body.project?.id;
  expect(id, "response must include project.id").toBeTruthy();
  return id!;
}

async function deleteProject(request: APIRequestContext, page: Page, projectId: string) {
  const headers = await freshAuthHeader(page).catch(() => ({}));
  await request
    .delete(`${BASE}/api/studio-projects/${projectId}`, { headers })
    .catch(() => {});
}

async function readCanvasFile(
  request: APIRequestContext,
  page: Page,
  projectId: string,
): Promise<{ ok: boolean; content: string | null }> {
  const resp = await request.post(`${BASE}/api/studio-projects/${projectId}/files`, {
    headers: await freshAuthHeader(page),
    data: { action: "read", path: CANVAS_FILE },
  });
  if (!resp.ok()) return { ok: false, content: null };
  const data = (await resp.json()) as { content?: string };
  return { ok: true, content: data.content ?? null };
}

/** Wait for the debounced .litt/canvas.json write POST from useCanvasFileSync. */
function waitForCanvasWrite(page: Page, projectId: string, timeout = 30_000) {
  return page.waitForRequest(
    (req) =>
      req.method() === "POST" &&
      req.url().includes(`/api/studio-projects/${projectId}/files`) &&
      (req.postData() ?? "").includes('"write"') &&
      (req.postData() ?? "").includes(CANVAS_FILE),
    { timeout },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 10 (anonymous): network isolation proof + auth gating truthfulness
// ─────────────────────────────────────────────────────────────────────────────
test.describe("anonymous — isolation + auth gating", () => {
  test.beforeEach(() => {
    skipUnlessStack();
    const project = test.info().project.name;
    test.skip(project !== "e2e-anonymous", "anonymous-only assertions");
  });

  test("Studio is auth-gated (no bypass configured)", async ({ page }) => {
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    // Truthful assertion: the authed shell must NOT render anonymously.
    await expect(page.getByTestId("studio-command-composer")).toHaveCount(0);
    // Clerk middleware should have redirected to a sign-in surface.
    expect(page.url()).toMatch(/sign-in|sign-up|accounts\.clerk|clerk\./i);
  });

  test("off-allowlist requests are blocked and recorded", async ({ page, e2eViolations }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Prove the context-level allowlist aborts external egress: a page-context
    // fetch to an external host must reject, not merely fail at the app layer.
    // A top-level navigation exercises the context route for real —
    // page-context fetch() can be blocked by CSP before it ever reaches
    // the network, which would prove nothing about the allowlist.
    const blocked = await page
      .goto("https://www.google-analytics.com/", { waitUntil: "commit", timeout: 15_000 })
      .then(() => "REACHABLE")
      .catch(() => "BLOCKED");
    expect(blocked).toBe("BLOCKED");
    expect(
      e2eViolations.some((v) => v.url.includes("google-analytics.com")),
      "violation should be recorded for the blocked host",
    ).toBe(true);
    // Drain so the auto fail-closed assertion stays green — the mechanism is
    // what this test verifies, not the absence of violations.
    e2eViolations.length = 0;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenarios 2, 3, 7, 8: project-less builder UI (editing is localStorage-backed)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("onboarding gate → canvas builder", () => {
  test.beforeEach(() => {
    skipUnlessStack();
    skipUnlessAuthedProject();
  });

  const SEED_TEXT = "E2E seed text";

  // Product decision (2H): a user with zero projects must see the onboarding
  // composer — the design tool is reached only after a project exists.
  test("zero-project user sees onboarding composer, not the builder", async ({ page }) => {
    await seedCanvasStorage(page, SEED_TEXT);
    await page.goto("/studio?tool=design", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("studio-command-composer")).toBeVisible({ timeout: 60_000 });
    // Truthful gate: the project-less builder (CanvasToolbar Save) must NOT mount.
    await expect(page.getByTitle("Save", { exact: true })).toHaveCount(0);
  });

  test("project creation transitions into the visual Canvas Builder", async ({ page, context }) => {
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    const projectId = await createDisposableProject(context.request, page);
    try {
      await page.goto(`/studio?tool=design&project=${projectId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByTestId("project-design-surface")).toBeVisible({ timeout: 60_000 });
      // The seeded local doc is debounce-written to the project workspace —
      // proves the builder's file-sync path is active in the design surface.
      const writeRequest = waitForCanvasWrite(page, projectId);
      await seedCanvasStorage(page, SEED_TEXT);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("project-design-surface")).toBeVisible({ timeout: 60_000 });
      await writeRequest;
      const file = await readCanvasFile(context.request, page, projectId);
      expect(file.ok).toBe(true);
      expect(file.content).toContain(SEED_TEXT);
    } finally {
      await deleteProject(context.request, page, projectId);
    }
  });

  test("canvas content persists across reload inside the created project", async ({ page, context }) => {
    const PERSIST_TEXT = "E2E persisted design text";
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    const projectId = await createDisposableProject(context.request, page);
    try {
      const writeRequest = waitForCanvasWrite(page, projectId);
      await seedCanvasStorage(page, PERSIST_TEXT);
      await page.goto(`/studio?tool=design&project=${projectId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByTestId("project-design-surface")).toBeVisible({ timeout: 60_000 });
      await writeRequest;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("project-design-surface")).toBeVisible({ timeout: 60_000 });
      const file = await readCanvasFile(context.request, page, projectId);
      expect(file.ok).toBe(true);
      expect(file.content).toContain(PERSIST_TEXT);
    } finally {
      await deleteProject(context.request, page, projectId);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenarios 1, 4, 5, 6, 9: disposable project + .litt/canvas.json file sync
// ─────────────────────────────────────────────────────────────────────────────
test.describe("canvas file sync — disposable project", () => {
  test.beforeEach(() => {
    skipUnlessStack();
    skipUnlessAuthedProject();
  });

  const SYNC_TEXT = "E2E synced canvas text";

  test("loads disposable project, syncs canvas doc to .litt/canvas.json, persists across reload", async ({
    page,
    context,
  }) => {
    // Load the authed shell first so the live Clerk session can mint the
    // fresh token the fixture API calls require (storage-state goes stale).
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    const projectId = await createDisposableProject(context.request, page);
    try {
      // Seed a local doc newer than anything on the server; the file-sync
      // hook (mounted by VisualCanvasBuilder) debounce-writes it to the
      // project workspace on load.
      const writeRequest = waitForCanvasWrite(page, projectId);
      await seedCanvasStorage(page, SYNC_TEXT);
      await page.goto(`/studio?tool=design&project=${projectId}`, {
        waitUntil: "domcontentloaded",
      });
      // With a project active the surface is project-first.
      await expect(page.getByTestId("project-design-surface")).toBeVisible({ timeout: 60_000 });

      await writeRequest;

      // Verify canvas→file sync via read-back (the file route proxies the
      // E2E terminal-server workspace backend).
      const first = await readCanvasFile(context.request, page, projectId);
      expect(first.ok, ".litt/canvas.json should be readable after sync write").toBe(true);
      expect(first.content).toContain(SYNC_TEXT);

      // Save+reload persistence: after reload the file still holds the edit.
      await page.reload({ waitUntil: "domcontentloaded" });
      const second = await readCanvasFile(context.request, page, projectId);
      expect(second.ok).toBe(true);
      expect(second.content).toContain(SYNC_TEXT);
    } finally {
      await deleteProject(context.request, page, projectId);
    }
  });

  test("save-failure is truthful and recovers on retry", async ({ page, context }) => {
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    const projectId = await createDisposableProject(context.request, page);
    const FAILED_TEXT = "E2E failed-write text";
    const RECOVERED_TEXT = "E2E recovered-write text";
    try {
      // Force the workspace write to fail — same-origin route interception,
      // still inside the allowlist.
      await page.route(`**/api/studio-projects/${projectId}/files`, async (route) => {
        const body = route.request().postData() ?? "";
        if (route.request().method() === "POST" && body.includes('"write"')) {
          await route.fulfill({ status: 503, body: JSON.stringify({ error: "e2e forced failure" }) });
          return;
        }
        await route.continue();
      });

      const failedWrite = waitForCanvasWrite(page, projectId);
      await seedCanvasStorage(page, FAILED_TEXT);
      await page.goto(`/studio?tool=design&project=${projectId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByTestId("project-design-surface")).toBeVisible({ timeout: 60_000 });
      await failedWrite;

      // Truthfulness: nothing may be persisted server-side for the failed write.
      const afterFailure = await readCanvasFile(context.request, page, projectId);
      expect(afterFailure.content ?? "").not.toContain(FAILED_TEXT);

      // Recovery: unblock the route, seed a NEWER doc, reload — the debounced
      // writer must succeed this time.
      await page.unroute(`**/api/studio-projects/${projectId}/files`);
      const recoveredWrite = waitForCanvasWrite(page, projectId);
      await seedCanvasStorage(page, RECOVERED_TEXT);
      await page.reload({ waitUntil: "domcontentloaded" });
      await recoveredWrite;

      const afterRecovery = await readCanvasFile(context.request, page, projectId);
      expect(afterRecovery.ok).toBe(true);
      expect(afterRecovery.content).toContain(RECOVERED_TEXT);
    } finally {
      await deleteProject(context.request, page, projectId);
    }
  });
});
