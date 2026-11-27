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
  "Full project builds",
  "Design and copy",
  "Asset generation",
  "File editing",
  "Live preview",
  "Publish-ready",
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
      radial-gradient(920px 540px at 50% -14%, rgba(34, 211, 238, 0.12), transparent 64%),
      radial-gradient(880px 580px at 90% 94%, rgba(168, 85, 247, 0.11), transparent 64%),
      radial-gradient(540px 420px at 8% 88%, rgba(59, 130, 246, 0.07), transparent 62%),
      #05070d;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 44px 20px;
    position: relative;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(148, 163, 184, 0.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148, 163, 184, 0.045) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(760px 560px at 50% 42%, black 25%, transparent 78%);
    -webkit-mask-image: radial-gradient(760px 560px at 50% 42%, black 25%, transparent 78%);
  }
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(120% 95% at 50% 46%, transparent 58%, rgba(2, 4, 10, 0.5) 100%);
  }
  .litt-welcome {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 660px;
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  @keyframes litt-card-in {
    from { opacity: 0; transform: translateY(12px) scale(0.99); }
    to { opacity: 1; transform: none; }
  }
  @keyframes litt-rise {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: none; }
  }
  @keyframes litt-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(0.8); }
  }
  .litt-rise { animation: litt-rise 0.6s cubic-bezier(0.22, 0.68, 0.31, 1) both; }
  .litt-card {
    position: relative;
    width: 100%;
    text-align: center;
    padding: 40px 44px 38px;
    border-radius: 24px;
    border: 1px solid rgba(148, 163, 184, 0.15);
    background: linear-gradient(180deg, rgba(18, 26, 43, 0.66), rgba(9, 13, 24, 0.7));
    box-shadow: 0 30px 90px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    animation: litt-card-in 0.55s cubic-bezier(0.22, 0.68, 0.31, 1) both;
  }
  .litt-card::before {
    content: "";
    position: absolute;
    top: -1px;
    left: 14%;
    right: 14%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.55), rgba(168, 85, 247, 0.55), transparent);
  }
  .litt-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #a5f3fc;
    background: rgba(34, 211, 238, 0.07);
    border: 1px solid rgba(34, 211, 238, 0.22);
    border-radius: 999px;
    padding: 6px 14px;
    margin-bottom: 24px;
    animation-delay: 0.1s;
  }
  .litt-status .dot {
    width: 7px; height: 7px; border-radius: 999px;
    background: #22d3ee;
    box-shadow: 0 0 10px #22d3ee;
    animation: litt-pulse 2.2s ease-in-out infinite;
  }
  .litt-mark {
    width: 68px; height: 68px;
    margin: 0 auto 22px;
    border-radius: 20px;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(145deg, rgba(34, 211, 238, 0.14), rgba(168, 85, 247, 0.14));
    border: 1px solid rgba(139, 92, 246, 0.32);
    box-shadow:
      0 0 0 6px rgba(139, 92, 246, 0.05),
      0 0 40px rgba(34, 211, 238, 0.22),
      0 0 80px rgba(168, 85, 247, 0.13),
      inset 0 0 22px rgba(34, 211, 238, 0.07);
    animation-delay: 0.16s;
  }
  .litt-mark svg { width: 36px; height: 36px; filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.7)); }
  .litt-card h1 {
    margin: 0;
    font-size: clamp(2.15rem, 6vw, 3.3rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.08;
    text-wrap: balance;
    background: linear-gradient(100deg, #f8fafc 25%, #a5f3fc 58%, #c4b5fd 88%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation-delay: 0.24s;
  }
  .litt-sub {
    margin: 12px 0 0;
    font-size: clamp(1.02rem, 2.6vw, 1.22rem);
    color: #c3cede;
    font-weight: 500;
    animation-delay: 0.3s;
  }
  .litt-body {
    margin: 14px auto 0;
    max-width: 500px;
    font-size: 0.95rem;
    line-height: 1.65;
    color: #8d99ae;
    animation-delay: 0.36s;
  }
  .litt-start-label {
    margin: 26px 0 12px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #5d6b82;
    animation-delay: 0.42s;
  }
  .litt-prompts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
  }
  .litt-prompt {
    font: inherit;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    font-size: 0.92rem;
    color: #dbe4f0;
    background: linear-gradient(180deg, rgba(23, 32, 51, 0.6), rgba(13, 19, 32, 0.6));
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 12px;
    padding: 12px 14px;
    cursor: pointer;
    transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
    animation: litt-rise 0.55s cubic-bezier(0.22, 0.68, 0.31, 1) both;
  }
  .litt-prompt:nth-child(1) { animation-delay: 0.46s; }
  .litt-prompt:nth-child(2) { animation-delay: 0.52s; }
  .litt-prompt:nth-child(3) { animation-delay: 0.58s; }
  .litt-prompt:nth-child(4) { animation-delay: 0.64s; }
  .litt-prompt:hover, .litt-prompt:focus-visible {
    border-color: rgba(34, 211, 238, 0.55);
    box-shadow: 0 8px 28px rgba(34, 211, 238, 0.14);
    transform: translateY(-1px);
    outline: none;
  }
  .litt-prompt .idx {
    flex-shrink: 0;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #67e8f9;
    border: 1px solid rgba(103, 232, 249, 0.28);
    background: rgba(34, 211, 238, 0.07);
    border-radius: 6px;
    padding: 2px 7px;
  }
  .litt-prompt .txt { flex: 1; }
  .litt-prompt .arrow {
    flex-shrink: 0;
    color: #5d6b82;
    transition: transform 0.18s ease, color 0.18s ease;
  }
  .litt-prompt:hover .arrow, .litt-prompt:focus-visible .arrow {
    transform: translateX(3px);
    color: #22d3ee;
  }
  .litt-cta {
    font: inherit;
    margin-top: 26px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 1rem;
    letter-spacing: 0.01em;
    color: #04121a;
    background: linear-gradient(100deg, #22d3ee, #818cf8 58%, #a855f7);
    border: none;
    border-radius: 12px;
    padding: 14px 34px;
    cursor: pointer;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.38),
      0 10px 32px rgba(56, 189, 248, 0.26),
      0 4px 16px rgba(168, 85, 247, 0.2);
    transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
    animation: litt-rise 0.6s cubic-bezier(0.22, 0.68, 0.31, 1) 0.72s both;
  }
  .litt-cta:hover, .litt-cta:focus-visible {
    transform: translateY(-2px);
    filter: brightness(1.07);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.42),
      0 14px 42px rgba(56, 189, 248, 0.34),
      0 6px 20px rgba(168, 85, 247, 0.26);
    outline: none;
  }
  .litt-meta {
    margin-top: 26px;
    max-width: 560px;
    text-align: center;
    animation-delay: 0.8s;
  }
  .litt-caps {
    margin: 0;
    font-size: 0.76rem;
    letter-spacing: 0.02em;
    line-height: 1.75;
    color: #5d6b82;
  }
  .litt-caps .sep { color: #3d4a61; }
  .litt-foot {
    margin: 12px 0 0;
    font-size: 0.75rem;
    line-height: 1.6;
    color: #48546a;
  }
  @media (max-width: 480px) {
    body { padding: 28px 16px; }
    .litt-card { padding: 34px 22px 30px; border-radius: 20px; }
    .litt-mark { width: 58px; height: 58px; border-radius: 17px; margin-bottom: 22px; }
    .litt-mark svg { width: 30px; height: 30px; }
    .litt-prompt { padding: 12px; font-size: 0.88rem; }
    .litt-cta { width: 100%; justify-content: center; }
  }
  @media (max-height: 560px) {
    .litt-card { padding-top: 30px; padding-bottom: 28px; }
    .litt-status { margin-bottom: 18px; }
    .litt-mark { margin-bottom: 18px; }
    .litt-start-label { margin-top: 22px; }
    .litt-cta { margin-top: 22px; }
    .litt-meta { margin-top: 18px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .litt-card, .litt-rise, .litt-prompt, .litt-cta, .litt-status .dot { animation: none; }
    .litt-prompt, .litt-prompt .arrow, .litt-cta { transition: none; }
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
  (p, i) =>
    `        <button type="button" class="litt-prompt" data-starter-prompt="${p}"><span class="idx">${String(i + 1).padStart(2, "0")}</span><span class="txt">${p}</span><span class="arrow" aria-hidden="true">&rarr;</span></button>`,
).join("\n");

const CAPABILITIES_HTML = WELCOME_CAPABILITIES.join(` <span class="sep">&middot;</span> `);

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
    <section class="litt-card">
      <div class="litt-status litt-rise"><span class="dot"></span>Workspace ready</div>
      <div class="litt-mark litt-rise">${BOLT_SVG}</div>
      <h1 class="litt-rise">Welcome to LiTT</h1>
      <p class="litt-sub litt-rise">Your AI workspace is ready.</p>
      <p class="litt-body litt-rise">Tell LiTT what you want to build &mdash; a website, business, app, landing page, automation, or something completely new.</p>
      <p class="litt-start-label litt-rise">Quick starts</p>
      <div class="litt-prompts">
${PROMPT_BUTTONS_HTML}
      </div>
      <button type="button" class="litt-cta" id="litt-start-building">Start Building <span aria-hidden="true">&rarr;</span></button>
    </section>
    <div class="litt-meta litt-rise">
      <p class="litt-caps">${CAPABILITIES_HTML}</p>
      <p class="litt-foot">This is your blank workspace &mdash; not a website yet. As soon as LiTT creates your real files, this screen is replaced by your actual project.</p>
    </div>
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
    (p, i) =>
      `        <button type="button" className="litt-prompt" data-starter-prompt=${JSON.stringify(p)} onClick={() => sendPrompt(${JSON.stringify(p)})}><span className="idx">${String(i + 1).padStart(2, "0")}</span><span className="txt">${escapeJsxText(p)}</span><span className="arrow" aria-hidden="true">&rarr;</span></button>`,
  ).join("\n");
  const caps = WELCOME_CAPABILITIES.map(escapeJsxText).join(` <span className="sep">&middot;</span> `);
  return `    <main className="litt-welcome">
      <section className="litt-card">
        <div className="litt-status litt-rise"><span className="dot"></span>Workspace ready</div>
        <div className="litt-mark litt-rise">${BOLT_SVG.replace(/class=/g, "className=").replace(/stop-color/g, "stopColor")}</div>
        <h1 className="litt-rise">Welcome to LiTT</h1>
        <p className="litt-sub litt-rise">Your AI workspace is ready.</p>
        <p className="litt-body litt-rise">Tell LiTT what you want to build &mdash; a website, business, app, landing page, automation, or something completely new.</p>
        <p className="litt-start-label litt-rise">Quick starts</p>
        <div className="litt-prompts">
${prompts}
        </div>
        <button type="button" className="litt-cta" onClick={() => sendCta()}>Start Building <span aria-hidden="true">&rarr;</span></button>
      </section>
      <div className="litt-meta litt-rise">
        <p className="litt-caps">${caps}</p>
        <p className="litt-foot">This is your blank workspace &mdash; not a website yet. As soon as LiTT creates your real files, this screen is replaced by your actual project.</p>
      </div>
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
