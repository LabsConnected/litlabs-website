import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import "@testing-library/jest-dom";

import { SafeEmailText, SafeEmailLink } from "./SafeEmail";

/**
 * Cloudflare's edge email obfuscation rewrites plain-text emails and
 * mailto: hrefs in the served HTML. Simulate that rewrite on the SSR
 * output, then hydrate: without suppressHydrationWarning React reports
 * error #418 (recoverable error → whole tree client-rendered).
 */
function cloudflareRewrite(html: string): string {
  return html
    .replaceAll(
      'href="mailto:support@litlabs.net"',
      'href="/cdn-cgi/l/email-protection#abc123"',
    )
    .replaceAll("support@litlabs.net", "[email&#160;protected]");
}

async function hydrateAndCollect(html: string, node: React.ReactNode) {
  const container = document.createElement("div");
  container.innerHTML = cloudflareRewrite(html);
  document.body.appendChild(container);

  const recoverableErrors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container, node, {
      onRecoverableError: (e) => recoverableErrors.push(e),
    });
  });

  // Snapshot the hydrated DOM BEFORE teardown — this is what the user sees.
  const textContent = container.textContent ?? "";
  const anchorHref = container.querySelector("a")?.getAttribute("href");

  await act(async () => root?.unmount());
  container.remove();
  return { recoverableErrors, textContent, anchorHref };
}

describe("SafeEmail hydration (Cloudflare email obfuscation)", () => {
  it("SafeEmailText hydrates cleanly over obfuscated markup", async () => {
    const node = (
      <p>
        Contact us at <SafeEmailText email="support@litlabs.net" /> today.
      </p>
    );
    const html = renderToString(node);
    expect(html).toContain("support@litlabs.net");

    const { recoverableErrors, textContent } = await hydrateAndCollect(
      html,
      node,
    );
    expect(recoverableErrors).toHaveLength(0);
    // React leaves the obfuscated text alone for Cloudflare's decode
    // script (which runs in the real browser) to restore.
    expect(textContent).toContain("[email\u00a0protected]");
  });

  it("SafeEmailLink hydrates cleanly over obfuscated href + text", async () => {
    const node = (
      <SafeEmailLink email="support@litlabs.net" className="x" />
    );
    const html = renderToString(node);
    expect(html).toContain('href="mailto:support@litlabs.net"');

    const { recoverableErrors, anchorHref } = await hydrateAndCollect(
      html,
      node,
    );
    expect(recoverableErrors).toHaveLength(0);
    // React leaves the obfuscated href alone; Cloudflare's decode script
    // restores the real mailto: in the browser.
    expect(anchorHref).toBe("/cdn-cgi/l/email-protection#abc123");
  });

  it("a bare email WITHOUT the guard reproduces React #418", async () => {
    const node = <p>Contact us at support@litlabs.net today.</p>;
    const html = renderToString(node);
    const { recoverableErrors } = await hydrateAndCollect(html, node);
    // Proves the test simulates the real failure: unguarded email text
    // against Cloudflare-obfuscated HTML must raise a hydration error.
    expect(recoverableErrors.length).toBeGreaterThan(0);
  });
});
