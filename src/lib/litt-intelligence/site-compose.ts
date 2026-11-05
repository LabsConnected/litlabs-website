import "server-only";

/**
 * Deterministic site composer — the JSON-first generation path for the
 * local small lane.
 *
 * A 1.5B-class model is reliable at short structured output (a plan) and
 * unreliable at thousands of tokens of layout CSS. site.compose moves the
 * fragile part out of the model entirely: the model emits a small
 * validated plan (title, theme, accent, ordered sections with copy), this
 * module assembles a complete styled index.html from a server-side
 * section library and design system, and the write lands through the
 * normal files.write handler — same path guard, destructive-rewrite
 * guard, approval gate, and enrichment pass as any other mutation.
 *
 * The result is a REAL HTML file in the workspace: follow-up edits use
 * files.read/apply_patch on it exactly like hand-written output, and a
 * files.write full-control path remains available — templates accelerate
 * generation, they never lock the user in.
 *
 * Every model-supplied string is HTML-escaped before it enters the
 * document: the composed page cannot carry markup, script, or injected
 * attributes — the plan is data, not HTML.
 */

// ─── Public types ────────────────────────────────────────────────────

export interface SitePlanSection {
  kind: string;
  heading?: string;
  subheading?: string;
  kicker?: string;
  text?: string;
  button?: string;
  cta?: string;
  href?: string;
  image?: string;
  variant?: string;
  items?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  plans?: Array<Record<string, unknown>>;
  images?: unknown[];
}

export interface SitePlan {
  title: string;
  description?: string;
  theme?: string;
  accentHue?: number;
  nav?: Array<{ label: string; target?: string }>;
  hero?: SitePlanSection;
  sections: SitePlanSection[];
}

export interface SitePlanValidation {
  ok: boolean;
  errors: string[];
  plan?: SitePlan;
}

// ─── Escaping ────────────────────────────────────────────────────────

function esc(value: unknown, maxLen = 400): string {
  const s = String(value ?? "").slice(0, maxLen);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value: string, fallback: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return s || fallback;
}

function unesc(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// ─── Themes ──────────────────────────────────────────────────────────

interface Theme {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  onAccent: string;
  accentHue: number;
  displayFont: string;
  bodyFont: string;
  heroOverlay: string;
}

const THEMES: Record<string, Theme> = {
  light: {
    bg: "#fafaf9", surface: "#ffffff", surfaceAlt: "#f4f4f2",
    text: "#1c1917", muted: "#57534e", border: "#e7e5e4",
    onAccent: "#ffffff", accentHue: 215,
    displayFont: "Georgia,'Times New Roman',serif",
    bodyFont: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    heroOverlay: "linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.55))",
  },
  dark: {
    bg: "#0c0c0f", surface: "#16161c", surfaceAlt: "#1e1e26",
    text: "#f4f4f5", muted: "#a1a1aa", border: "#2a2a33",
    onAccent: "#ffffff", accentHue: 260,
    displayFont: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    bodyFont: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    heroOverlay: "linear-gradient(180deg,rgba(0,0,0,.45),rgba(0,0,0,.7))",
  },
  warm: {
    bg: "#fdf8f2", surface: "#fffdfa", surfaceAlt: "#f6ede1",
    text: "#2d2118", muted: "#7a6553", border: "#eaddcf",
    onAccent: "#ffffff", accentHue: 24,
    displayFont: "Georgia,'Times New Roman',serif",
    bodyFont: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    heroOverlay: "linear-gradient(180deg,rgba(40,20,5,.35),rgba(40,20,5,.6))",
  },
  forest: {
    bg: "#f4f7f4", surface: "#ffffff", surfaceAlt: "#e6efe6",
    text: "#16211a", muted: "#4d6353", border: "#d4e0d4",
    onAccent: "#ffffff", accentHue: 150,
    displayFont: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    bodyFont: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    heroOverlay: "linear-gradient(180deg,rgba(5,30,15,.4),rgba(5,30,15,.65))",
  },
  ocean: {
    bg: "#f3f7fa", surface: "#ffffff", surfaceAlt: "#e3edf4",
    text: "#101d26", muted: "#4c6373", border: "#d2dfe8",
    onAccent: "#ffffff", accentHue: 200,
    displayFont: "Georgia,'Times New Roman',serif",
    bodyFont: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    heroOverlay: "linear-gradient(180deg,rgba(5,25,40,.4),rgba(5,25,40,.65))",
  },
  mono: {
    bg: "#ffffff", surface: "#fafafa", surfaceAlt: "#f0f0f0",
    text: "#111111", muted: "#555555", border: "#dddddd",
    onAccent: "#ffffff", accentHue: 0,
    displayFont: "'Courier New',Courier,monospace",
    bodyFont: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    heroOverlay: "linear-gradient(180deg,rgba(0,0,0,.4),rgba(0,0,0,.65))",
  },
};

const THEME_NAMES = Object.keys(THEMES);

// ─── Design system CSS ───────────────────────────────────────────────

function designSystemCss(theme: Theme, accentHue: number): string {
  const accent = `hsl(${accentHue} 70% 45%)`;
  const accentSoft = `hsl(${accentHue} 70% 45% / 0.12)`;
  return `
:root{
  --bg:${theme.bg};--surface:${theme.surface};--surface-alt:${theme.surfaceAlt};
  --text:${theme.text};--muted:${theme.muted};--border:${theme.border};
  --accent:${accent};--accent-soft:${accentSoft};--on-accent:${theme.onAccent};
  --radius:14px;--radius-sm:9px;
  --shadow:0 1px 2px rgba(16,24,40,.06),0 4px 16px rgba(16,24,40,.08);
  --shadow-lg:0 8px 30px rgba(16,24,40,.14);
  --font-display:${theme.displayFont};--font-body:${theme.bodyFont};
  --hero-overlay:${theme.heroOverlay};
  --maxw:1120px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:var(--font-body);background:var(--bg);color:var(--text);
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img{max-width:100%;height:auto;display:block}
h1,h2,h3,h4{font-family:var(--font-display);line-height:1.15;margin:0 0 .5em;
  font-size:clamp(1.55rem,3.2vw,2.5rem);letter-spacing:-.01em}
h1{font-size:clamp(2.3rem,5.4vw,4rem)}
h3{font-size:clamp(1.15rem,2vw,1.4rem)}
p{margin:0 0 1em}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:var(--maxw);margin:0 auto;padding:0 24px}
.skip-link{position:absolute;left:-9999px;top:0;background:var(--accent);color:var(--on-accent);
  padding:10px 18px;border-radius:0 0 var(--radius-sm) 0;z-index:100}
.skip-link:focus{left:0}
::selection{background:var(--accent);color:var(--on-accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
.site-nav{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.site-nav .container{display:flex;align-items:center;justify-content:space-between;
  padding-top:14px;padding-bottom:14px;gap:16px}
.brand{font-family:var(--font-display);font-weight:700;font-size:1.15rem;color:var(--text);
  text-decoration:none;letter-spacing:-.01em}
.nav-links{display:flex;gap:4px;flex-wrap:wrap;list-style:none;margin:0;padding:0}
.nav-links a{color:var(--muted);padding:8px 13px;border-radius:var(--radius-sm);
  font-size:.93rem;font-weight:500;transition:color .15s,background .15s}
.nav-links a:hover{color:var(--text);background:var(--surface-alt);text-decoration:none}
.btn{display:inline-block;background:var(--accent);color:var(--on-accent);padding:13px 26px;
  border-radius:var(--radius-sm);font-weight:600;font-size:.98rem;border:none;cursor:pointer;
  transition:transform .15s,box-shadow .15s,filter .15s}
.btn:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg);filter:brightness(1.06);text-decoration:none}
.btn-outline{background:transparent;color:var(--text);border:1.5px solid var(--border)}
.btn-outline:hover{border-color:var(--accent);color:var(--accent)}
.hero{position:relative;display:flex;align-items:center;min-height:min(88vh,760px);
  background-size:cover;background-position:center;color:#fff}
.hero::before{content:"";position:absolute;inset:0;background:var(--hero-overlay)}
.hero .container{position:relative;z-index:1;padding-top:72px;padding-bottom:72px}
.hero.no-image{background:linear-gradient(135deg,var(--accent) 0%,hsl(${accentHue} 70% 30%) 100%)}
.hero.no-image::before{display:none}
.hero-split .container{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
.hero .lead{font-size:clamp(1.05rem,2vw,1.3rem);max-width:34em;opacity:.94;margin-bottom:1.6em}
.hero .actions{display:flex;gap:14px;flex-wrap:wrap}
.hero-media img{border-radius:var(--radius);box-shadow:var(--shadow-lg);width:100%;object-fit:cover;aspect-ratio:4/3}
.section{padding:76px 0}
.section.alt{background:var(--surface-alt)}
.section-head{max-width:640px;margin:0 auto 48px;text-align:center}
.section-head .kicker{display:inline-block;color:var(--accent);font-weight:700;font-size:.8rem;
  letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px}
.section-head p{color:var(--muted);font-size:1.06rem}
.grid{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:28px;box-shadow:var(--shadow);transition:transform .2s,box-shadow .2s}
.card:hover{transform:translateY(-4px);box-shadow:var(--shadow-lg)}
.card .icon{width:44px;height:44px;border-radius:12px;background:var(--accent-soft);
  display:flex;align-items:center;justify-content:center;margin-bottom:16px;color:var(--accent)}
.card h3{margin-bottom:.4em}
.card p{color:var(--muted);margin:0;font-size:.96rem}
.gallery-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.gallery-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius);
  transition:transform .25s,box-shadow .25s}
.gallery-grid img:hover{transform:scale(1.02);box-shadow:var(--shadow-lg)}
.quote{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:30px;box-shadow:var(--shadow)}
.quote p{font-family:var(--font-display);font-size:1.12rem;font-style:italic;margin-bottom:14px}
.quote cite{color:var(--muted);font-style:normal;font-size:.9rem;font-weight:600}
.quote cite::before{content:"— "}
.plan{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:32px;box-shadow:var(--shadow);display:flex;flex-direction:column}
.plan.featured{border-color:var(--accent);box-shadow:var(--shadow-lg);position:relative}
.plan.featured::before{content:"Popular";position:absolute;top:-11px;left:50%;transform:translateX(-50%);
  background:var(--accent);color:var(--on-accent);font-size:.72rem;font-weight:700;
  padding:4px 14px;border-radius:99px;letter-spacing:.06em;text-transform:uppercase}
.plan .price{font-family:var(--font-display);font-size:2.2rem;font-weight:700;margin:.2em 0 .4em}
.plan ul{list-style:none;margin:0 0 24px;padding:0;flex:1}
.plan li{padding:8px 0 8px 28px;position:relative;color:var(--muted);font-size:.95rem;border-bottom:1px solid var(--border)}
.plan li:last-child{border-bottom:none}
.plan li::before{content:"";position:absolute;left:0;top:14px;width:16px;height:16px;border-radius:50%;
  background:var(--accent-soft) center/10px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23777' stroke-width='3'%3E%3Cpath d='M5 13l4 4L19 7'/%3E%3C/svg%3E")}
.stats{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));text-align:center}
.stat .num{font-family:var(--font-display);font-size:clamp(2rem,4vw,3rem);font-weight:700;color:var(--accent)}
.stat .lbl{color:var(--muted);font-size:.92rem;text-transform:uppercase;letter-spacing:.08em}
.prose{max-width:44em;font-size:1.06rem}
.prose p{color:var(--muted)}
.cta-band{background:linear-gradient(120deg,var(--accent),hsl(${accentHue} 70% 32%));color:#fff;
  border-radius:var(--radius);padding:64px 40px;text-align:center;position:relative;overflow:hidden}
.cta-band h2{color:#fff}
.cta-band p{opacity:.9;max-width:36em;margin:0 auto 1.6em}
.cta-band .btn{background:#fff;color:${theme.text}}
.split-2{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.split-2 img{border-radius:var(--radius);box-shadow:var(--shadow-lg);width:100%;object-fit:cover;aspect-ratio:4/3}
.contact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}
.contact-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:22px;text-align:center}
.contact-item strong{display:block;margin-bottom:6px;font-family:var(--font-display)}
.contact-item span{color:var(--muted);font-size:.95rem}
.site-footer{background:var(--surface-alt);border-top:1px solid var(--border);padding:48px 0 28px;margin-top:0}
.site-footer .cols{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap;margin-bottom:28px}
.site-footer .foot-brand{font-family:var(--font-display);font-weight:700;font-size:1.1rem}
.site-footer .foot-note{color:var(--muted);font-size:.92rem;max-width:30em;margin-top:8px}
.site-footer .foot-links{display:flex;gap:8px;flex-wrap:wrap;list-style:none;margin:0;padding:0}
.site-footer .foot-links a{color:var(--muted);padding:6px 10px;border-radius:var(--radius-sm);font-size:.92rem}
.site-footer .foot-links a:hover{color:var(--text);background:var(--surface)}
.site-footer .legal{color:var(--muted);font-size:.82rem;border-top:1px solid var(--border);padding-top:20px;
  display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
.reveal{opacity:0;transform:translateY(18px);animation:rise .6s ease forwards}
@keyframes rise{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}
  html{scroll-behavior:auto}
  .reveal{opacity:1;transform:none}
}
@media (max-width:760px){
  .section{padding:52px 0}
  .hero-split .container,.split-2{grid-template-columns:1fr}
  .hero{min-height:auto}.hero .container{padding-top:56px;padding-bottom:56px}
  .nav-links{display:none}
  .site-nav .container{justify-content:center}
}
`.trim();
}

// ─── Section renderers ───────────────────────────────────────────────

const SVG_ICONS: Record<string, string> = {
  check: '<path d="M5 13l4 4L19 7"/>',
  star: '<path d="M12 2l3 6.5 7 .8-5.2 4.7 1.4 6.9L12 17.5 5.8 21l1.4-6.9L2 9.3l7-.8z"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  leaf: '<path d="M12 22C7 17 4 13 4 9a8 8 0 0 1 16 0c0 4-3 8-8 13z"/><path d="M12 22V9"/>',
  cup: '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 9h2a3 3 0 0 1 0 6h-2"/><path d="M7 2v3M11 2v3"/>',
  phone: '<path d="M5 4h4l2 5-3 2a13 13 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A19 19 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  pin: '<path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z"/><circle cx="12" cy="10" r="3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  heart: '<path d="M12 21C6 16 3 12.5 3 9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 3.5-3 7-9 12z"/>',
};

function svgIcon(name: unknown): string {
  const key = String(name ?? "").toLowerCase().trim();
  const path = SVG_ICONS[key] ?? SVG_ICONS.check;
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function sectionHead(sec: SitePlanSection, defaultHeading: string): string {
  const heading = esc(sec.heading ?? defaultHeading, 120);
  const sub = esc(sec.subheading ?? "", 240);
  return `<div class="section-head"><span class="kicker">${esc(sec.kicker ?? "", 40) || "LiTT"}</span>` +
    `<h2>${heading}</h2>` +
    (sub ? `<p>${sub}</p>` : "") +
    `</div>`;
}

function renderFeatures(sec: SitePlanSection): string {
  const items = (sec.items ?? []).slice(0, 9);
  const cards = items.map((it) => {
    const icon = `<div class="icon">${svgIcon(it.icon)}</div>`;
    return `<div class="card">${icon}<h3>${esc(it.title ?? it.name ?? "Feature", 80)}</h3><p>${esc(it.text ?? it.description ?? "", 280)}</p></div>`;
  }).join("\n");
  return `<div class="grid">${cards}</div>`;
}

function renderGallery(sec: SitePlanSection): string {
  const imgs = (sec.images ?? (sec.items ?? [])).slice(0, 8);
  const html = imgs.map((img) => {
    const kw = typeof img === "string" ? img : String((img as Record<string, unknown>)?.keywords ?? (img as Record<string, unknown>)?.q ?? "");
    const alt = esc(kw || sec.heading || "Photo", 120);
    return `<img data-litt-image="${esc(kw || "photography", 80)}" alt="${alt}" loading="lazy">`;
  }).join("\n");
  return `<div class="gallery-grid">${html}</div>`;
}

function renderTestimonials(sec: SitePlanSection): string {
  const items = (sec.items ?? []).slice(0, 6);
  const cards = items.map((it) =>
    `<figure class="quote"><p>&ldquo;${esc(it.quote ?? it.text ?? "", 320)}&rdquo;</p>` +
    `<figcaption><cite>${esc(it.author ?? it.name ?? "Customer", 80)}</cite>` +
    (it.role ? ` <span style="color:var(--muted)">&middot; ${esc(it.role, 60)}</span>` : "") +
    `</figcaption></figure>`,
  ).join("\n");
  return `<div class="grid">${cards}</div>`;
}

function renderPricing(sec: SitePlanSection): string {
  const plans = (sec.plans ?? sec.items ?? []).slice(0, 4);
  const html = plans.map((p, i) => {
    const feats = (Array.isArray(p.features) ? p.features : [])
      .slice(0, 8)
      .map((f) => `<li>${esc(f, 90)}</li>`)
      .join("");
    const cta = esc(p.cta ?? sec.button ?? "Choose plan", 40);
    const href = esc(p.href ?? "#contact", 120);
    return `<div class="plan${i === 1 && plans.length > 1 ? " featured" : ""}">` +
      `<h3>${esc(p.name ?? "Plan", 60)}</h3>` +
      `<div class="price">${esc(p.price ?? "", 30)}</div>` +
      `<ul>${feats}</ul><a class="btn" href="${href}">${cta}</a></div>`;
  }).join("\n");
  return `<div class="grid">${html}</div>`;
}

function renderStats(sec: SitePlanSection): string {
  const items = (sec.items ?? []).slice(0, 6);
  const html = items.map((it) =>
    `<div class="stat"><div class="num">${esc(it.value ?? it.num ?? "", 20)}</div>` +
    `<div class="lbl">${esc(it.label ?? it.title ?? "", 60)}</div></div>`,
  ).join("\n");
  return `<div class="stats">${html}</div>`;
}

function renderAbout(sec: SitePlanSection): string {
  const text = esc(sec.text ?? sec.subheading ?? "", 1200);
  const paragraphs = text.split(/\n{2,}|\n/).filter(Boolean).map((p) => `<p>${p}</p>`).join("\n");
  const img = sec.image
    ? `<img data-litt-image="${esc(sec.image, 80)}" alt="${esc(sec.heading ?? "About", 100)}" loading="lazy">`
    : "";
  if (img) {
    return `<div class="split-2"><div class="prose"><h2>${esc(sec.heading ?? "About", 120)}</h2>${paragraphs}</div><div>${img}</div></div>`;
  }
  return `<div class="prose" style="margin:0 auto"><h2>${esc(sec.heading ?? "About", 120)}</h2>${paragraphs}</div>`;
}

function renderCta(sec: SitePlanSection): string {
  const button = esc(sec.button ?? sec.cta ?? "Get started", 40);
  const href = esc(sec.href ?? "#contact", 120);
  const text = esc(sec.text ?? sec.subheading ?? "", 300);
  return `<div class="cta-band"><h2>${esc(sec.heading ?? "Ready?", 120)}</h2>` +
    (text ? `<p>${text}</p>` : "") +
    `<a class="btn" href="${href}">${button}</a></div>`;
}

function renderContact(sec: SitePlanSection): string {
  const items = (sec.items ?? []).slice(0, 6);
  const html = items.map((it) =>
    `<div class="contact-item"><strong>${esc(it.label ?? it.title ?? "", 60)}</strong><span>${esc(it.value ?? it.text ?? "", 120)}</span></div>`,
  ).join("\n");
  return `<div class="contact-grid">${html}</div>`;
}

function renderFooter(sec: SitePlanSection, title: string): string {
  const links = (sec.links ?? sec.items ?? []).slice(0, 8);
  const linkHtml = links.length
    ? `<ul class="foot-links">${links.map((l) => `<li><a href="${esc(l.href ?? "#", 120)}">${esc(l.label ?? l.text ?? "Link", 40)}</a></li>`).join("")}</ul>`
    : "";
  const text = esc(sec.text ?? sec.subheading ?? "", 200);
  return `<div class="cols"><div><div class="foot-brand">${esc(title, 60)}</div>` +
    (text ? `<div class="foot-note">${text}</div>` : "") +
    `</div>${linkHtml}</div>` +
    `<div class="legal"><span>&copy; ${new Date().getFullYear()} ${esc(title, 60)}</span><span>Built with LiTT</span></div>`;
}

const KNOWN_KINDS = new Set([
  "features", "services", "cards", "gallery", "testimonials", "pricing",
  "stats", "about", "cta", "contact", "footer", "text", "prose", "menu",
]);

function renderSection(sec: SitePlanSection, index: number): { id: string; html: string; label: string } {
  const kind = String(sec.kind ?? "").toLowerCase();
  const id = slugify(`${kind}-${index + 1}`, `section-${index + 1}`);
  const label = String(sec.heading ?? kind);
  let inner: string;
  let alt = index % 2 === 1;
  switch (kind) {
    case "features": case "services": case "cards": case "menu":
      inner = sectionHead(sec, "Features") + renderFeatures(sec); break;
    case "gallery":
      inner = sectionHead(sec, "Gallery") + renderGallery(sec); break;
    case "testimonials":
      inner = sectionHead(sec, "Testimonials") + renderTestimonials(sec); break;
    case "pricing":
      inner = sectionHead(sec, "Pricing") + renderPricing(sec); break;
    case "stats":
      return { id, html: `<section id="${id}" class="section alt reveal"><div class="container">${renderStats(sec)}</div></section>`, label: String(sec.heading ?? "Stats") };
    case "about": case "text": case "prose":
      inner = renderAbout(sec); alt = false; break;
    case "cta":
      inner = renderCta(sec); break;
    case "contact":
      inner = sectionHead(sec, "Contact") + renderContact(sec); break;
    default:
      inner = sectionHead(sec, "More") + `<div class="prose" style="margin:0 auto"><p>${esc(sec.text ?? sec.subheading ?? "", 800)}</p></div>`;
  }
  return {
    id,
    label,
    html: `<section id="${id}" class="section${alt ? " alt" : ""} reveal"><div class="container">${inner}</div></section>`,
  };
}

function renderHero(hero: SitePlanSection | undefined, title: string, description: string | undefined): { navCta: string; html: string } {
  const h: SitePlanSection = hero ?? { kind: "hero" };
  const variant = String(h.variant ?? (h.image ? "split" : "center")).toLowerCase();
  const headline = esc(h.heading ?? title, 140);
  const sub = esc(h.subheading ?? h.text ?? description ?? "", 280);
  const cta = esc(h.cta ?? h.button ?? "Learn more", 40);
  const ctaHref = esc(h.href ?? "#main", 120);
  const bgAttr = h.image ? ` data-litt-bg="${esc(h.image, 80)}"` : "";
  const cls = h.image ? "hero" : "hero no-image";
  if (variant === "split" && h.image) {
    return {
      navCta: cta,
      html:
        `<section class="hero hero-split no-image"><div class="container"><div>` +
        `<h1>${headline}</h1><p class="lead">${sub}</p>` +
        `<div class="actions"><a class="btn" href="${ctaHref}">${cta}</a></div></div>` +
        `<div class="hero-media"><img data-litt-image="${esc(h.image, 80)}" alt="${headline}" fetchpriority="high"></div>` +
        `</div></section>`,
    };
  }
  return {
    navCta: cta,
    html:
      `<section class="${cls}"${bgAttr}><div class="container" style="max-width:760px;text-align:center">` +
      `<h1>${headline}</h1><p class="lead" style="margin-left:auto;margin-right:auto">${sub}</p>` +
      `<div class="actions" style="justify-content:center"><a class="btn" href="${ctaHref}">${cta}</a></div>` +
      `</div></section>`,
  };
}

// ─── Plan validation ─────────────────────────────────────────────────

const MAX_SECTIONS = 12;
const MAX_PLAN_BYTES = 8000;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown, maxLen: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, maxLen) : undefined;
}

function strArr(v: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, maxLen));
  return out.length ? out.slice(0, maxItems) : undefined;
}

function objArr(v: unknown, maxItems: number): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(isObj);
  return out.length ? out.slice(0, maxItems) : undefined;
}

/**
 * Strict structural validation of a model-emitted site plan. Returns
 * {ok:false, errors:[...]} with actionable messages the model can fix on
 * a retry — never a silent default that produces a page the user did not
 * ask for.
 */
export function validateSitePlan(raw: unknown): SitePlanValidation {
  const errors: string[] = [];
  if (!isObj(raw)) {
    return { ok: false, errors: ["plan must be a JSON object"] };
  }
  if (JSON.stringify(raw).length > MAX_PLAN_BYTES) {
    return { ok: false, errors: [`plan exceeds ${MAX_PLAN_BYTES} bytes — simplify it`] };
  }
  const title = str(raw.title, 80);
  if (!title) errors.push('title is required (the site name, e.g. "Ember Roast")');
  const sections = Array.isArray(raw.sections) ? raw.sections.filter(isObj) : [];
  if (sections.length === 0) errors.push("sections must be a non-empty array — pick at least 2-3 section kinds");
  if (sections.length > MAX_SECTIONS) errors.push(`too many sections (${sections.length} > ${MAX_SECTIONS})`);
  for (const [i, s] of sections.entries()) {
    const kind = str(s.kind, 24)?.toLowerCase();
    if (!kind) {
      errors.push(`sections[${i}].kind is required`);
    } else if (!KNOWN_KINDS.has(kind)) {
      errors.push(`sections[${i}].kind "${kind}" is not one of: ${[...KNOWN_KINDS].join(", ")}`);
    }
    const needsItems = ["features", "services", "cards", "menu", "testimonials", "stats", "contact"].includes(kind ?? "");
    if (needsItems && !objArr(s.items, 9)) {
      errors.push(`sections[${i}] (${kind}) needs an items array of {title,text} objects`);
    }
    if (kind === "gallery" && !strArr(s.images, 8, 80) && !objArr(s.items, 8)) {
      errors.push(`sections[${i}] (gallery) needs an images array of short keyword strings`);
    }
    if (kind === "pricing" && !objArr(s.plans, 4) && !objArr(s.items, 4)) {
      errors.push(`sections[${i}] (pricing) needs a plans array of {name,price,features[]}`);
    }
    if ((kind === "about" || kind === "text" || kind === "prose") && !str(s.text, 1200) && !str(s.subheading, 1200)) {
      errors.push(`sections[${i}] (${kind}) needs a text field with the section's real copy`);
    }
  }
  const theme = str(raw.theme, 16)?.toLowerCase();
  if (theme && !THEMES[theme]) {
    errors.push(`theme "${theme}" is not one of: ${THEME_NAMES.join(", ")}`);
  }
  let accentHue: number | undefined;
  if (raw.accentHue !== undefined) {
    const n = Number(raw.accentHue);
    if (!Number.isFinite(n) || n < 0 || n > 360) {
      errors.push("accentHue must be a number 0-360");
    } else {
      accentHue = Math.round(n);
    }
  }
  const hero = isObj(raw.hero) ? (raw.hero as unknown as SitePlanSection) : undefined;
  if (hero?.variant && !["center", "split", "banner"].includes(String(hero.variant))) {
    errors.push('hero.variant must be "center", "split", or "banner"');
  }
  if (errors.length) return { ok: false, errors };
  const nav = objArr(raw.nav, 8)?.map((l) => ({ label: String(l.label ?? l.text ?? "").slice(0, 30), target: str(l.target ?? l.href, 120) }));
  return {
    ok: true,
    errors: [],
    plan: {
      title: title!,
      description: str(raw.description, 200),
      theme,
      accentHue,
      nav,
      hero,
      sections: sections.slice(0, MAX_SECTIONS) as unknown as SitePlanSection[],
    },
  };
}

// ─── Assembly ────────────────────────────────────────────────────────

export function composeSiteHtml(plan: SitePlan): string {
  const theme = THEMES[plan.theme ?? "light"] ?? THEMES.light;
  const accentHue = plan.accentHue ?? theme.accentHue;
  const css = designSystemCss(theme, accentHue);

  const rendered = plan.sections
    .filter((s) => String(s.kind ?? "").toLowerCase() !== "footer")
    .map((s, i) => renderSection(s, i));
  const footerSec = plan.sections.find((s) => String(s.kind ?? "").toLowerCase() === "footer");

  // Nav: model-supplied entries win; otherwise derive from section
  // headings (real anchors → functioning navigation by construction).
  const navItems = plan.nav?.length
    ? plan.nav.map((l) => ({ label: l.label, href: l.target && l.target.startsWith("#") ? l.target : `#${slugify(l.target ?? l.label, "section")}` }))
    : rendered
        .filter((r) => r.label && r.label.length > 1)
        .slice(0, 6)
        .map((r) => ({ label: r.label.slice(0, 24), href: `#${r.id}` }));
  const navHtml = navItems.map((l) => `<li><a href="${esc(l.href, 120)}">${esc(l.label, 30)}</a></li>`).join("");

  const footerHtml = `<footer class="site-footer"><div class="container">${
    footerSec ? renderFooter(footerSec, plan.title) : renderFooter({ kind: "footer" }, plan.title)
  }</div></footer>`;

  const body = [
    renderHero(plan.hero, plan.title, plan.description).html,
    `<main id="main">`,
    ...rendered.map((r) => r.html),
    `</main>`,
    footerHtml,
  ].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(plan.title, 80)}</title>
<meta name="description" content="${esc(plan.description ?? `${plan.title}`, 160)}">
<style>${css}</style>
</head>
<body id="top" data-theme="${esc(plan.theme ?? "light", 16)}">
<a class="skip-link" href="#main">Skip to content</a>
<nav class="site-nav"><div class="container">
<a class="brand" href="#top">${esc(plan.title, 40)}</a>
<ul class="nav-links">${navHtml}</ul>
</div></nav>
${body}
</body>
</html>`;
}

// ─── Section-level patching ──────────────────────────────────────────
//
// Semantic edit path for composed pages: the model names a region
// (hero / footer / a section kind like "menu" or an id like "features-2")
// plus replacement fields, and the server splices the change in — no
// verbatim search strings, which 1.5B-class models cannot reliably copy
// out of a 10KB+ document. Scalar fields (heading, text, cta, image) are
// patched surgically so everything else is preserved byte-for-byte; list
// fields (items/plans/images/links) re-render that one region
// deterministically through the same section library.

export interface SectionEditResult {
  ok: boolean;
  html?: string;
  error?: string;
  region?: string;
}

interface RegionBounds {
  start: number;
  end: number;
  kind: string;
  index: number;
}

function findRegion(html: string, section: string): RegionBounds | null {
  const wanted = section.trim().toLowerCase();
  if (!wanted) return null;
  if (wanted === "footer") {
    const m = /<footer[\s>]/i.exec(html);
    if (!m) return null;
    const close = /<\/footer>/i.exec(html.slice(m.index));
    if (!close) return null;
    return { start: m.index, end: m.index + close.index + close[0].length, kind: "footer", index: 0 };
  }
  if (wanted === "hero" || wanted === "header") {
    const m = /<section[^>]*class="[^"]*hero[^"]*"[^>]*>/i.exec(html);
    if (!m) return null;
    const close = /<\/section>/i.exec(html.slice(m.index + m[0].length));
    if (!close) return null;
    return { start: m.index, end: m.index + m[0].length + close.index + close[0].length, kind: "hero", index: 0 };
  }
  // Generic sections carry id="<kind>-<n>". Accept a bare kind (first
  // match), an explicit id ("features-2"), or "kind n" phrasing.
  const idMatch = /^([a-z]+?)(?:[-\s](\d+))?$/.exec(wanted);
  if (!idMatch) return null;
  const kind = idMatch[1];
  const nth = idMatch[2] ? parseInt(idMatch[2], 10) : 1;
  const re = new RegExp(`<section[^>]*id="${kind.replace(/[^a-z]/g, "")}-(\\d+)"[^>]*>`, "gi");
  let m: RegExpExecArray | null;
  let seen = 0;
  while ((m = re.exec(html)) !== null) {
    seen += 1;
    const idx = parseInt(m[1], 10) - 1;
    const isTarget = idMatch[2] ? idx === nth - 1 : seen === 1;
    if (!isTarget) continue;
    const close = /<\/section>/i.exec(html.slice(m.index + m[0].length));
    if (!close) return null;
    return { start: m.index, end: m.index + m[0].length + close.index + close[0].length, kind, index: idx };
  }
  return null;
}

function pageTitle(html: string): string {
  return unesc(/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "Site").trim() || "Site";
}

/** Replace the inner text of the first tag matching `re` inside `region`. */
function replaceTagText(region: string, re: RegExp, value: string): string | null {
  const m = re.exec(region);
  const tag = m ? /<([a-zA-Z][a-zA-Z0-9]*)/.exec(m[0])?.[1] : null;
  if (!m || !tag) return null;
  const openEnd = m.index + m[0].length;
  const closeRe = new RegExp(`</${tag}>`, "i");
  const close = closeRe.exec(region.slice(openEnd));
  if (!close) return null;
  return region.slice(0, openEnd) + esc(value, 400) + region.slice(openEnd + close.index);
}

const LIST_FIELDS = new Set(["items", "plans", "images", "links"]);

export function applySectionEdit(
  html: string,
  section: string,
  fields: Record<string, unknown>,
): SectionEditResult {
  const bounds = findRegion(html, section);
  if (!bounds) {
    return { ok: false, error: `no "${section}" region found in the page — this file was not generated by site.compose or the section name is wrong. Use files.read + apply_patch instead.` };
  }
  const region = html.slice(bounds.start, bounds.end);
  const f = { ...fields, kind: bounds.kind } as unknown as SitePlanSection;
  const hasListField = [...LIST_FIELDS].some((k) => fields[k] !== undefined);

  // List fields → deterministic re-render of just this region.
  if (hasListField) {
    let replacement: string;
    if (bounds.kind === "footer") {
      replacement = `<footer class="site-footer"><div class="container">${renderFooter(f, pageTitle(html))}</div></footer>`;
    } else if (bounds.kind === "hero") {
      replacement = renderHero(f, pageTitle(html), undefined).html;
    } else {
      replacement = renderSection(f, bounds.index).html;
    }
    return { ok: true, html: html.slice(0, bounds.start) + replacement + html.slice(bounds.end), region: bounds.kind };
  }

  // Scalar fields → surgical text replacements inside the region.
  let next = region;
  const heading = fields.heading ?? fields.title;
  const subheading = fields.subheading ?? fields.lead;
  const text = fields.text;
  const cta = fields.cta ?? fields.button;
  const image = fields.image;
  let changed = 0;

  if (typeof heading === "string" && heading.trim()) {
    const r = bounds.kind === "hero" ? replaceTagText(next, /<h1[^>]*>/i, heading) : replaceTagText(next, /<(h2|h3)[^>]*>/i, heading);
    if (r) { next = r; changed++; }
  }
  if (typeof subheading === "string" && subheading.trim()) {
    const r = replaceTagText(next, /<p[^>]*class="[^"]*lead[^"]*"[^>]*>/i, subheading) ?? replaceTagText(next, /<p[^>]*>/i, subheading);
    if (r) { next = r; changed++; }
  }
  if (typeof text === "string" && text.trim()) {
    let r: string | null = null;
    if (bounds.kind === "footer") {
      r = replaceTagText(next, /<div[^>]*class="[^"]*foot-note[^"]*"[^>]*>/i, text);
      if (!r) {
        const brand = /<div[^>]*class="[^"]*foot-brand[^"]*"[^>]*>[^<]*<\/div>/i.exec(next);
        if (brand) {
          const at = brand.index + brand[0].length;
          r = next.slice(0, at) + `<div class="foot-note">${esc(text, 200)}</div>` + next.slice(at);
        }
      }
    }
    r ??= replaceTagText(next, /<p[^>]*>/i, text);
    if (r) { next = r; changed++; }
  }
  if (typeof cta === "string" && cta.trim()) {
    const r = replaceTagText(next, /<a[^>]*class="[^"]*btn[^"]*"[^>]*>/i, cta);
    if (r) { next = r; changed++; }
  }
  if (typeof image === "string" && image.trim()) {
    let r: string | null = null;
    if (/data-litt-(image|bg)="[^"]*"/i.test(next)) {
      r = next.replace(/data-litt-(image|bg)="[^"]*"/i, `data-litt-image="${esc(image, 80)}"`);
    } else if (/<img\b/i.test(next)) {
      r = next.replace(/<img\b/i, `<img data-litt-image="${esc(image, 80)}"`);
    }
    if (r) { next = r; changed++; }
  }

  if (changed === 0) {
    return {
      ok: false,
      error:
        `nothing to change: give the fields to update (heading, subheading, text, cta, image) ` +
        `for the "${bounds.kind}" region, or items/plans/images for a full section rebuild.`,
    };
  }
  return { ok: true, html: html.slice(0, bounds.start) + next + html.slice(bounds.end), region: bounds.kind };
}
