import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import "@testing-library/jest-dom";

import { SafeEmailText, SafeEmailLink } from "./SafeEmail";

/**
 * SafeEmail v2: the email address is assembled client-side in a useEffect,
 * so the server HTML contains no email pattern for Cloudflare to obfuscate.
 * These tests verify:
 * 1. SSR output contains NO raw email (Cloudflare has nothing to rewrite).
 * 2. Hydration is clean (server placeholder === client initial render).
 * 3. After effects run, the real email + mailto link appear.
 */

async function hydrateAndCollect(html: string, node: React.ReactNode) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  const recoverableErrors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container, node, {
      onRecoverableError: (e) => recoverableErrors.push(e),
    });
  });

  const textAfterHydration = container.textContent ?? "";
  const hrefAfterHydration = container.querySelector("a")?.getAttribute("href");

  // Let effects run
  await act(async () => {});

  const textAfterEffects = container.textContent ?? "";
  const hrefAfterEffects = container.querySelector("a")?.getAttribute("href");

  root?.unmount();
  container.remove();
  return {
    recoverableErrors,
    textAfterHydration,
    hrefAfterHydration,
    textAfterEffects,
    hrefAfterEffects,
  };
}

describe("SafeEmail (client-assembled, Cloudflare-proof)", () => {
  it("SafeEmailText: SSR has no email, hydrates clean, effect reveals email", async () => {
    const html = renderToString(<SafeEmailText email="support@litlabs.net" />);
    expect(html).not.toContain("support@litlabs.net");
    expect(html).not.toContain("mailto:");

    const r = await hydrateAndCollect(html, <SafeEmailText email="support@litlabs.net" />);
    expect(r.recoverableErrors).toEqual([]);
    // After effects, the real email appears
    expect(r.textAfterEffects).toContain("support@litlabs.net");
  });

  it("SafeEmailLink: SSR has no email, hydrates clean, effect reveals mailto", async () => {
    const html = renderToString(
      <SafeEmailLink email="support@litlabs.net" className="x" />,
    );
    expect(html).not.toContain("support@litlabs.net");
    expect(html).not.toContain("mailto:");

    const r = await hydrateAndCollect(
      html,
      <SafeEmailLink email="support@litlabs.net" className="x" />,
    );
    expect(r.recoverableErrors).toEqual([]);
    expect(r.hrefAfterEffects).toBe("mailto:support@litlabs.net");
    expect(r.textAfterEffects).toContain("support@litlabs.net");
  });

  it("does not regress: plain email text without SafeEmail still mismatches when obfuscated", async () => {
    // Negative control: unguarded email that Cloudflare rewrites DOES trigger #418.
    const html = renderToString(<span>support@litlabs.net</span>);
    const obfuscated = html.replaceAll("support@litlabs.net", "[email&#160;protected]");
    const r = await hydrateAndCollect(obfuscated, <span>support@litlabs.net</span>);
    expect(r.recoverableErrors.length).toBeGreaterThan(0);
  });
});
