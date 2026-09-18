/**
 * LiTT Studio welcome / blank-state screen.
 *
 * This is the initial content seeded into a brand-new project workspace
 * (the `blank-static`, `nextjs`, and `react-vite` templates). It is NOT a
 * project and it is NOT fake project content: it is the clearly-labeled
 * empty state of the LiTT builder itself.
 *
 * The agent MUST replace this file with the user's real project files as
 * soon as it starts building. The `LITT-WELCOME-SCREEN` marker comment lets
 * the platform detect "still on the welcome screen" vs. a real project.
 *
 * Starter prompts and the CTA post a `litt-welcome` message to the parent
 * window; the Studio preview panel turns those into `studio:ask-litt`
 * events that open LiTT chat with the prompt pre-filled.
 */

export const WELCOME_SCREEN_MARKER = "LITT-WELCOME-SCREEN";

export const WELCOME_PROMPTS = [
  "Build me a modern website for my business.",
  "Create a landing page for my new product.",
  "Build a booking page for my local service.",
  "Design a portfolio site for my work.",
] as const;

const WELCOME_CAPABILITIES = [
  "Build the project",
  "Generate the design and copy",
  "Create assets",
  "Edit files",
  "Preview changes live",
  "Get it ready to publish",
] as const;

const WELCOME_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e8eef7;
    background:
      radial-gradient(720px 480px at 18% 12%, rgba(34, 211, 238, 0.14), transparent 62%),
      radial-gradient(760px 520px at 84% 88%, rgba(168, 85, 247, 0.13), transparent 62%),
      radial-gradient(520px 380px at 78% 18%, rgba(59, 130, 246, 0.10), transparent 60%),
      #05070d;
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: 40px 20px;
    position: relative;
    overflow-x: hidden;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(148, 163, 184, 0.055) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148, 163, 184, 0.055) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(640px 480px at 50% 42%, black 30%, transparent 78%);
    -webkit-mask-image: radial-gradient(640px 480px at 50% 42%, black 30%, transparent 78%);
  }
  .litt-welcome { position: relative; width: 100%; max-width: 660px; text-align: center; margin: auto; }
  .litt-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #a5f3fc;
    background: rgba(34, 211, 238, 0.08);
    border: 1px solid rgba(34, 211, 238, 0.28);
    border-radius: 999px;
    padding: 7px 16px;
    margin-bottom: 28px;
    box-shadow: 0 0 24px rgba(34, 211, 238, 0.18);
  }
  .litt-status .dot {
    width: 8px; height: 8px; border-radius: 999px;
    background: #22d3ee;
    box-shadow: 0 0 10px #22d3ee;
    animation: litt-pulse 2.2s ease-in-out infinite;
  }
  @keyframes litt-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(0.8); }
  }
  .litt-mark {
    width: 76px; height: 76px;
    margin: 0 auto 24px;
    border-radius: 22px;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, rgba(34,211,238,0.16), rgba(168,85,247,0.16));
    border: 1px solid rgba(139, 92, 246, 0.35);
    box-shadow: 0 0 42px rgba(34, 211, 238, 0.28), 0 0 90px rgba(168, 85, 247, 0.16), inset 0 0 24px rgba(34,211,238,0.08);
  }
  .litt-mark svg { width: 40px; height: 40px; filter: drop-shadow(0 0 8px rgba(34,211,238,0.7)); }
  h1 {
    margin: 0 0 10px;
    font-size: clamp(2.1rem, 6vw, 3.4rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    background: linear-gradient(100deg, #f8fafc 20%, #a5f3fc 55%, #c4b5fd 85%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .litt-sub { margin: 0 0 18px; font-size: clamp(1.05rem, 3vw, 1.3rem); color: #cbd5e1; font-weight: 500; }
  .litt-body { margin: 0 auto 8px; max-width: 560px; font-size: 0.98rem; line-height: 1.65; color: #94a3b8; }
  .litt-caps { list-style: none; margin: 22px auto 0; padding: 0; max-width: 560px;
    display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .litt-caps li {
    font-size: 0.8rem; color: #c4b5fd;
    border: 1px solid rgba(168, 85, 247, 0.3);
    background: rgba(168, 85, 247, 0.08);
    border-radius: 999px; padding: 6px 13px; white-space: nowrap;
  }
  .litt-start-label { margin: 30px 0 12px; font-size: 0.85rem; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; }
  .litt-prompts { display: flex; flex-direction: column; gap: 10px; max-width: 520px; margin: 0 auto; }
  .litt-prompt {
    font: inherit;
    text-align: left;
    color: #e2e8f0;
    background: rgba(15, 23, 42, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 14px;
    padding: 13px 16px;
    cursor: pointer;
    transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
    backdrop-filter: blur(6px);
  }
  .litt-prompt:hover, .litt-prompt:focus-visible {
    border-color: rgba(34, 211, 238, 0.65);
    box-shadow: 0 0 22px rgba(34, 211, 238, 0.22);
    transform: translateY(-1px);
    outline: none;
  }
  .litt-prompt span { color: #22d3ee; margin-right: 8px; }
  .litt-cta {
    font: inherit;
    margin-top: 26px;
    display: inline-flex; align-items: center; gap: 10px;
    font-weight: 700; font-size: 1.02rem;
    color: #04121a;
    background: linear-gradient(100deg, #22d3ee, #818cf8 60%, #a855f7);
    border: none; border-radius: 14px;
    padding: 15px 34px;
    cursor: pointer;
    box-shadow: 0 8px 34px rgba(34, 211, 238, 0.35), 0 4px 18px rgba(168, 85, 247, 0.25);
    transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
  }
  .litt-cta:hover, .litt-cta:focus-visible {
    transform: translateY(-2px);
    filter: brightness(1.08);
    box-shadow: 0 12px 44px rgba(34, 211, 238, 0.45), 0 6px 24px rgba(168, 85, 247, 0.3);
    outline: none;
  }
  .litt-foot { margin: 30px auto 0; max-width: 480px; font-size: 0.78rem; line-height: 1.6; color: #475569; }
  @media (max-width: 480px) {
    body { padding: 28px 16px; }
    .litt-mark { width: 62px; height: 62px; border-radius: 18px; margin-bottom: 20px; }
    .litt-mark svg { width: 32px; height: 32px; }
    .litt-caps li { font-size: 0.74rem; padding: 5px 11px; }
    .litt-cta { width: 100%; justify-content: center; }
  }
  @media (prefers-reduced-motion: reduce) {
    .litt-status .dot { animation: none; }
    .litt-prompt, .litt-cta { transition: none; }
  }
`;

const BOLT_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="littBolt" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#22d3ee" />
          <stop offset="1" stop-color="#a855f7" />
        </linearGradient>
      </defs>
      <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" fill="url(#littBolt)" />
    </svg>`;

const PROMPT_BUTTONS_HTML = WELCOME_PROMPTS.map(
  (p) => `        <button type="button" class="litt-prompt" data-starter-prompt="${p}"><span>→</span>${p}</button>`,
).join("\n");

const CAPABILITIES_HTML = WELCOME_CAPABILITIES.map((c) => `      <li>${c}</li>`).join("\n");

const WELCOME_SCRIPT = `<script>
    (function () {
      function send(payload) {
        try {
          if (window.parent && window.parent !== window) {
            var msg = { source: "litt-welcome", type: payload.type };
            if (payload.prompt) msg.prompt = payload.prompt;
            window.parent.postMessage(msg, "*");
          }
        } catch (e) { /* preview not embedded; nothing to notify */ }
      }
      document.querySelectorAll("[data-starter-prompt]").forEach(function (el) {
        el.addEventListener("click", function () {
          var prompt = el.getAttribute("data-starter-prompt");
          if (prompt) send({ type: "starter-prompt", prompt: prompt });
        });
      });
      var cta = document.getElementById("litt-start-building");
      if (cta) cta.addEventListener("click", function () { send({ type: "welcome-cta" }); });
    })();
  </script>`;

/** Full standalone HTML document for the `blank-static` template. */
export function buildWelcomeHtml(): string {
  return `<!-- ${WELCOME_SCREEN_MARKER}: blank-state of the LiTT builder. Not a project, not project content.
     The agent MUST replace this file with the user's real project files as soon as it starts building. -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LiTT Studio &mdash; New Project</title>
  <style>${WELCOME_CSS}
  </style>
</head>
<body>
  <main class="litt-welcome">
    <div class="litt-status"><span class="dot"></span>Workspace ready</div>
    <div class="litt-mark">${BOLT_SVG}</div>
    <h1>Welcome to LiTT</h1>
    <p class="litt-sub">Your AI workspace is ready.</p>
    <p class="litt-body">Tell LiTT what you want to build &mdash; a website, business, app, landing page, automation, or something completely new.</p>
    <p class="litt-body">LiTT can help you:</p>
    <ul class="litt-caps">
${CAPABILITIES_HTML}
    </ul>
    <p class="litt-start-label">Start with something simple</p>
    <div class="litt-prompts">
${PROMPT_BUTTONS_HTML}
    </div>
    <button type="button" class="litt-cta" id="litt-start-building">Start Building <span aria-hidden="true">&rarr;</span></button>
    <p class="litt-foot">This is your blank workspace &mdash; not a website yet. As soon as LiTT creates your real files, this screen is replaced by your actual project.</p>
  </main>
${WELCOME_SCRIPT}
</body>
</html>
`;
}

function escapeJsxText(s: string): string {
  return s.replace(/&/g, "&amp;");
}

function buildWelcomeJsxBody(): string {
  const prompts = WELCOME_PROMPTS.map(
    (p) =>
      `        <button type="button" className="litt-prompt" onClick={() => sendPrompt(${JSON.stringify(p)})}><span>&rarr;</span>${escapeJsxText(p)}</button>`,
  ).join("\n");
  const caps = WELCOME_CAPABILITIES.map((c) => `      <li>${escapeJsxText(c)}</li>`).join("\n");
  return `    <main className="litt-welcome">
      <div className="litt-status"><span className="dot"></span>Workspace ready</div>
      <div className="litt-mark">${BOLT_SVG.replace(/class=/g, "className=")}</div>
      <h1>Welcome to LiTT</h1>
      <p className="litt-sub">Your AI workspace is ready.</p>
      <p className="litt-body">Tell LiTT what you want to build &mdash; a website, business, app, landing page, automation, or something completely new.</p>
      <p className="litt-body">LiTT can help you:</p>
      <ul className="litt-caps">
${caps}
      </ul>
      <p className="litt-start-label">Start with something simple</p>
      <div className="litt-prompts">
${prompts}
      </div>
      <button type="button" className="litt-cta" onClick={() => sendCta()}>Start Building <span aria-hidden="true">&rarr;</span></button>
      <p className="litt-foot">This is your blank workspace &mdash; not a website yet. As soon as LiTT creates your real files, this screen is replaced by your actual project.</p>
    </main>`;
}

const WELCOME_JSX_HELPERS = `function postWelcomeMessage(type: string, prompt?: string) {
  try {
    if (window.parent && window.parent !== window) {
      const msg: { source: string; type: string; prompt?: string } = { source: "litt-welcome", type };
      if (prompt) msg.prompt = prompt;
      window.parent.postMessage(msg, "*");
    }
  } catch {
    /* preview not embedded; nothing to notify */
  }
}

function sendPrompt(prompt: string) {
  postWelcomeMessage("starter-prompt", prompt);
}

function sendCta() {
  postWelcomeMessage("welcome-cta");
}`;

/** Next.js App Router page for the `nextjs` template. */
export function buildWelcomeNextJs(): string {
  return `{/* ${WELCOME_SCREEN_MARKER}: blank-state of the LiTT builder. Not a project, not project content.
    The agent MUST replace this file with the user's real project files as soon as it starts building. */}
"use client";

${WELCOME_JSX_HELPERS}

export default function Home() {
  return (
    <>
      <style>{\`${WELCOME_CSS}\`}</style>
${buildWelcomeJsxBody()}
    </>
  );
}
`;
}

/** React + Vite App component for the `react-vite` template. */
export function buildWelcomeReactVite(): string {
  return `// ${WELCOME_SCREEN_MARKER}: blank-state of the LiTT builder. Not a project, not project content.
// The agent MUST replace this file with the user's real project files as soon as it starts building.
${WELCOME_JSX_HELPERS}

export default function App() {
  return (
    <>
      <style>{\`${WELCOME_CSS}\`}</style>
${buildWelcomeJsxBody()}
    </>
  );
}
`;
}
