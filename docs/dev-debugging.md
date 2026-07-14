# Development debugging

The recommended VS Code stack for this Next.js 16, TypeScript, and Node project is Console Ninja, Error Lens, the built-in JavaScript debugger, Playwright Test, REST Client, and GitLens.

## Install the workspace recommendations

Open the Extensions view and run **Extensions: Show Recommended Extensions**, then install the workspace recommendations. The core debugging extension IDs are:

```text
WallabyJs.console-ninja
usernamehw.errorlens
ms-playwright.playwright
humao.rest-client
eamodio.gitlens
```

Console Ninja displays supported runtime logs and values near the source. Error Lens displays TypeScript and ESLint diagnostics inline. VS Code already includes the JavaScript debugger, so a separate Node or browser debugger extension is unnecessary.

## Debug the app

1. Open **Run and Debug** (`Ctrl+Shift+D`).
2. Select **Next.js: debug full stack**.
3. Press `F5`.
4. Set breakpoints in server code, route handlers, React components, or browser code.

The full-stack compound starts `pnpm dev` through a JavaScript Debug Terminal and launches a debugger-controlled Chromium window at `http://localhost:3000`. Use **Next.js: debug server (Webpack fallback)** if a Turbopack-specific issue prevents useful debugging.

If the app was started separately with Node inspector enabled on port 9229, use **Node: attach to port 9229**. For example, from PowerShell:

```powershell
$env:NODE_OPTIONS = "--inspect=9229"
pnpm dev
```

## Test API routes

Open `.vscode/api.http`, run **Rest Client: Switch Environment**, choose `local`, and select **Send Request** above a request. Replace the placeholder preview URL in `.vscode/settings.json` before choosing `preview`.

The included sample targets `/api/ai-chat` and `/api/llm/health`. The chat request may still require configured provider credentials and application authentication.

## UI and history debugging

- Use the Playwright sidebar for Playwright tests once a Playwright configuration and tests are present. This repository does not currently define a Playwright test script.
- Use GitLens file history or blame to trace a regression to the change that introduced it.
- Use the existing `Build` and `Lint` workspace tasks for repeatable diagnostics.

