import type { CSSProperties, ReactNode } from "react";

/**
 * SafeEmail — hydration-safe email rendering.
 *
 * Cloudflare's edge email obfuscation rewrites plain-text emails and
 * mailto: hrefs in the served HTML (`[email protected]` plus a decode
 * script that restores the real address on the client). React hydration
 * then compares its virtual DOM against the obfuscated markup, sees text
 * (or an href) that doesn't match, and throws error #418 — discarding
 * server rendering and client-rendering the whole tree.
 *
 * `suppressHydrationWarning` silences exactly that inevitable mismatch.
 * The anti-scrape protection stays on, and the decoded client content
 * always equals what React expects, so nothing visible changes.
 */

export function SafeEmailText({ email }: { email: string }) {
  return <span suppressHydrationWarning>{email}</span>;
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
  return (
    <a
      href={`mailto:${email}`}
      suppressHydrationWarning
      className={className}
      style={style}
    >
      {children ?? <SafeEmailText email={email} />}
    </a>
  );
}
