"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useTheme } from "@/context/ThemeContext";

/**
 * Cloudflare Turnstile widget — privacy-preserving CAPTCHA alternative.
 *
 * Renders an invisible/managed challenge. The token is passed to the
 * parent via onVerify, which should be sent to the API for verification.
 *
 * If Turnstile is not configured (no site key), renders nothing and
 * calls onVerify with null — the API will fail open in dev.
 */
export function TurnstileWidget({
  onVerify,
  className = "",
}: {
  onVerify: (token: string | null) => void;
  className?: string;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const { theme } = useTheme();

  if (!siteKey) {
    // Not configured — call onVerify with null so forms still work
    // (API will fail open in dev, fail closed in production)
    return null;
  }

  return (
    <div className={className}>
      <Turnstile
        siteKey={siteKey}
        onSuccess={(token) => onVerify(token)}
        onError={() => onVerify(null)}
        onExpire={() => onVerify(null)}
        options={{
          theme: theme.mode === "light" ? "light" : "dark",
          size: "normal",
        }}
      />
    </div>
  );
}
