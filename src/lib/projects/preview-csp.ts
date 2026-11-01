/**
 * Content-Security-Policy for static preview documents (/api/preview/...).
 *
 * Single source of truth imported by BOTH:
 *   - src/app/api/preview/[projectId]/[[...path]]/route.ts
 *   - next.config.ts (/api/preview/:path* header rule)
 * The next.config header wins over the route header in production, so the
 * two must never drift — importing one constant makes drift impossible.
 *
 * WHY RESOURCE LOADS ARE UNRESTRICTED (2026-10-30):
 * The previous policy allowlisted LiTT origins + localhost only. Generated
 * sites are contractually built on third-party assets — the canonical
 * runtime context instructs the model to emit
 *   <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">
 * plus Google Fonts stylesheets and stock images (Unsplash, placehold.co…).
 * Every one of those was blocked, so generated sites rendered completely
 * unstyled in the preview iframe while rendering fine once deployed.
 *
 * The allowlist could never enumerate the CDNs generated sites legitimately
 * use, and it never protected the real boundary anyway:
 *   - The document runs in an opaque origin (sandbox without
 *     allow-same-origin): no LiTT cookies, storage, or parent DOM access.
 *   - Workspace file reads are gated by the 5-minute, manifest-scoped
 *     capability token (preview-token.ts) — the token, never the CSP, is
 *     what bounds which workspace files are readable.
 *   - Deployed user content (/sites/:path*) ships the same HTML on the same
 *     origin with NO resource directives at all. Preview now has parity:
 *     an origin allowlist here would only diverge preview behavior from
 *     deployed behavior, i.e. "works in prod, broken in preview".
 *
 * `wasm-unsafe-eval` is required by the Tailwind v4 browser build, which
 * instantiates its Oxide WASM compiler in-page. `unsafe-eval`/`unsafe-inline`
 * cover generated inline scripts/styles. ws:/wss: allow generated pages to
 * open sockets for demos. http: is needed so same-origin subresources load
 * when Studio is served over plain http in dev; on https pages the
 * browser's own mixed-content rules still block insecure active content.
 */
export const PREVIEW_CONTENT_SECURITY_POLICY = [
  // Opaque origin, forms/popups/modals allowed — identical posture to the
  // deployed /sites CSP and to the iframe sandbox attribute in
  // StudioPreviewPanel.
  "sandbox allow-scripts allow-forms allow-modals allow-popups",
  "default-src https: http: data: blob: wss: ws:",
  "script-src https: http: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:",
  "style-src https: http: 'unsafe-inline' data:",
  "img-src https: http: data: blob:",
  "font-src https: http: data:",
  "connect-src https: http: wss: ws: data: blob:",
  "media-src https: http: data: blob:",
  "frame-src https: http: data: blob:",
  "worker-src https: http: data: blob:",
].join("; ");
