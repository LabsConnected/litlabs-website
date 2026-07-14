# 🛠 Dev Debugging Stack — LiTTree Lab Studios

> **TL;DR — Best 3-tool setup for this codebase:**
> **Console Ninja** + **Error Lens** + the **built-in VS Code JavaScript debugger**.
> That's the whole stack. No more flipping between Devin, the terminal, and
> browser DevTools for every bug.

---

## 1. Recommended VS Code extensions

These are listed in `.vscode/extensions.json`, so VS Code / Cursor will
prompt to install them the first time you open the workspace.

| Extension                       | Publisher / ID             | Why we use it                                                                               |
| ------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| **Console Ninja**               | `WallabyJs.console-ninja`  | Inline `console.log` output + runtime values shown **next to** the line that produced them. |
| **Error Lens**                  | `usernamehw.errorlens`     | TS / ESLint / build errors rendered inline at the end of the offending line.                |
| **Playwright Test for VS Code** | `ms-playwright.playwright` | Runs / debugs Playwright tests in-editor with a real browser panel.                         |
| **REST Client**                 | `humao.rest-client`        | Sends HTTP requests straight from `.http` files — perfect for testing Next.js API routes.   |
| **GitLens**                     | `eamodio.gitlens`          | Inline blame, history explorer, and "which commit broke this line" search.                  |

**You do NOT need** any third-party Node / Chrome / Edge debugger extension.
VS Code's built-in `node` and `chrome` debuggers already cover breakpoints,
call stacks, watches, source maps, and headless browser debugging.

### Guardrail: extensions we deliberately exclude

Also in `.vscode/extensions.json` under `unwantedRecommendations`:

- `msjsdiag.debugger-for-chrome` — superseded by the built-in JS debugger.
- `ms-vscode.vscode-js-debug` — bundled with VS Code since 1.46; not separate.
- `formulahendry.code-runner` — noisy output, ignores our test runner scripts.

---

## 2. Debug configurations (`.vscode/launch.json`)

The launch file ships with the following pre-wired configurations:

| Config name                                  | What it does                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Next.js: debug server (pnpm dev)**         | Launches `pnpm dev` with `--inspect=9229`, waits for `Local: http://…`, then auto-attaches Chrome. |
| **Next.js: debug webpack server (fallback)** | Same as above, but `pnpm dev:webpack` on port 9230. Use this if Turbopack is misbehaving.          |
| **Next.js: attach to running process**       | Attaches the debugger to an already-running `pnpm dev` (port 9229).                                |
| **Vitest: run current test file**            | Runs the open `*.test.ts(x)` file with Vitest.                                                     |
| **Vitest: debug current test file**          | Same, with `--inspect-brk`, so breakpoints in tests actually pause.                                |
| **Dev: full-stack (server + Chrome)**        | Compound launch — starts the server, then opens Chrome attached to it.                             |

### Common debugging flows

**Flow A — "Something broke on the server side"**

1. `Ctrl+Shift+D` → pick **Next.js: debug server (pnpm dev)**.
2. Set a breakpoint in `src/lib/litt.ts` (or any lib / route handler).
3. Press `F5`. Console Ninja will show you runtime values **inline** as the
   request hits the route.

**Flow B — "A React component isn't rendering right"**

1. Set a breakpoint in the component.
2. Run the **Next.js: debug server** config (which auto-attaches Chrome).
3. Step through — Error Lens keeps the type / lint errors visible at the
   end of each line, so you see issues as you go.

**Flow C — "The AI chat route is misbehaving"**

1. Open `.vscode/api.http`.
2. Pick the `local` environment in the REST Client status bar.
3. Click **Send Request** above the `/api/ai-chat` block.
4. Use the **Next.js: attach to running process** debug config to step
   into the route handler.

**Flow D — "A Playwright test is flaky"**

1. Open the test (e.g. `tests/e2e/foo.spec.ts`).
2. Use the **Testing** sidebar (`Ctrl+Shift+T` in Cursor) — Playwright
   runs / debugs tests in a real browser without leaving the editor.

---

## 3. Why Console Ninja + Error Lens + built-in debugger is the right combo

| Pain point                                           | Tool that solves it        |
| ---------------------------------------------------- | -------------------------- |
| "I want to see `console.log` without alt-tabbing"    | **Console Ninja**          |
| "I want to know what `obj` is at this exact line"    | **Console Ninja** (inline) |
| "I want lint / TS errors at the end of each line"    | **Error Lens**             |
| "I want a real breakpoint with call stack & watches" | **Built-in Node debugger** |
| "I want to know which commit broke this line"        | **GitLens**                |
| "I want to test an API route without writing code"   | **REST Client**            |
| "I want to fix a broken UI flow visually"            | **Playwright**             |

That covers ~95% of the debugging situations that come up in this codebase.

---

## 4. Settings the workspace forces (`.vscode/settings.json`)

The most relevant ones (all overridable in your user `settings.json` if you
disagree):

- `console-ninja.enabled: true` — auto-enables inline runtime values.
- `errorLens.enabled: true`, font 13, monospace — readable on Win11 scaling.
- `typescript.tsdk: node_modules/typescript/lib` — always uses the
  workspace TS, which Next.js 16 + Turbopack require.
- `editor.formatOnSave: true` + Prettier as default formatter.
- `search.exclude` skips `litlabs/`, `litlabs-website/`, `Zoo-Code/`,
  `chrome/`, `work/`, `meta/`, `codex-reference/` — these are the
  large local artifacts from `.gitignore`; no point searching them.

---

## 5. Gotchas specific to this codebase

- **Turbopack + `--inspect`**: the launch config passes `NODE_OPTIONS=--inspect=9229`
  to the `pnpm dev` process. If you instead run `pnpm dev` in your own
  terminal and want to attach, use the **attach** config — don't run two
  `pnpm dev` instances on the same port.
- **`lucide-react@1.24.0` is pinned** (very old). If Console Ninja shows
  `Icon is not exported from lucide-react` errors, don't `pnpm add` modern
  icons — copy the inline SVG pattern from
  `src/components/dashboard/AutonomicLoopBanner.tsx`.
- **Console Ninja + `--inspect-brk`**: if the dev server never finishes
  starting (e.g. it sits on a breakpoint before the Turbopack compile
  banner), check the **Terminal** panel for the compile progress — the
  `serverReadyAction` only fires once Turbopack prints `Local: http://…`.

---

_Last verified: 2026-07-13._
