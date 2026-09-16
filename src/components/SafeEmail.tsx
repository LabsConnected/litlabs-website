"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/**
 * SafeEmail — hydration-safe email rendering.
 *
 * Cloudflare's edge email obfuscation rewrites plain-text emails and
 * mailto: hrefs in the served HTML (`[email protected]` plus a decode
 * script). It also injects extra <span> wrappers, changing the DOM
 * structure — which suppressHydrationWarning cannot paper over (it only
 * handles text mismatches, not structural ones). React hydration then
 * throws error #418.
 *
 * Instead, the email address is assembled client-side in a useEffect.
 * The server renders a placeholder with no email pattern for Cloudflare
 * to detect; hydration matches (both render the placeholder); then the
 * effect swaps in the real mailto link and text. No obfuscation, no #418.
 */

function useClientEmail(email: string) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? email : null;
}

export function SafeEmailText({ email }: { email: string }) {
  const live = useClientEmail(email);
  return <span>{live ?? "[email protected]"}</span>;
}

export function SafeEmailLink({
  email,
  className,
  style,
  children,
}: {
  email: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const live = useClientEmail(email);
  return (
    <a
      href={live ? `mailto:${live}` : "#"}
      className={className}
      style={style}
    >
      {children ?? <SafeEmailText email={email} />}
    </a>
  );
}
