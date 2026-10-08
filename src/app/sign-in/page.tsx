"use client";

import { brand, color } from "@/lib/design/litt-tokens";
import { BrandLogo } from "@/components/branding/BrandLogo";

import { SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { getSafeRedirectUrl } from "@/lib/safe-redirect-url";

/**
 * Clerk's OAuth authorize endpoint redirects unauthenticated users to this
 * page with a `redirect_url` query parameter pointing back to the OAuth flow
 * (e.g. https://clerk.litlabs.net/oauth/authorize?...). Without preserving
 * that parameter, the <SignIn> component redirects to /studio after success
 * and the OAuth flow never completes.
 *
 * We read `redirect_url` and pass it to `forceRedirectUrl` so that after
 * successful sign-in, the browser returns to the OAuth authorize endpoint,
 * which now sees an active session and proceeds to /oauth-consent.
 */
function SignInContent() {
  const searchParams = useSearchParams();
  // Validate before use: an unvalidated redirect_url is an open redirect
  // (?redirect_url=https://evil.com sends a freshly-logged-in user off-site).
  let redirectUrl = getSafeRedirectUrl(searchParams.get("redirect_url"));

  // Clerk Dashboard may still point the OAuth consent URL to the old
  // Account Portal domain (accounts.litlabs.net). After sign-in on
  // www.litlabs.net, redirecting to accounts.litlabs.net loses the
  // session cookie and creates an infinite sign-in loop. Rewrite any
  // accounts.litlabs.net redirect to www.litlabs.net so the consent
  // page sees the active session.
  if (redirectUrl.includes("accounts.litlabs.net")) {
    redirectUrl = redirectUrl.replace(
      /https?:\/\/accounts\.litlabs\.net/g,
      "https://www.litlabs.net",
    );
  }

  return (
    <div
      className="min-h-dvh flex items-center justify-center px-4 py-8"
      style={{ backgroundColor: "#03050a" }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <BrandLogo href="/" size={36} showText={false} variant="full" />
          </div>
          <h1 className="text-sm font-bold" style={{ color: color.text.primary }}>
            Sign in to your AI workspace
          </h1>
        </div>

        <div
          className="rounded-xl p-1"
          style={{ backgroundColor: color.surface.DEFAULT, border: `1px solid ${color.border.DEFAULT}` }}
        >
          <SignIn
            forceRedirectUrl={redirectUrl}
            signUpUrl="/sign-up"
            appearance={{
              elements: {
                header: { display: "none" },
                rootBox: { width: "100%" },
                cardBox: { width: "100%", maxWidth: "100%" },
                formButtonPrimary: {
                  backgroundColor: brand.primary.DEFAULT,
                  color: color.text.onPrimary,
                  border: "none",
                  fontSize: "13px",
                  fontWeight: "bold",
                  borderRadius: "8px",
                },
                formFieldInput: {
                  backgroundColor: "#03050a",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: color.text.primary,
                  borderRadius: "8px",
                },
                footerActionLink: { color: brand.primary.DEFAULT },
                headerTitle: { color: "#e2e8f0" },
                headerSubtitle: { color: "#94a3b8" },
                socialButtonsBlockButton: {
                  border: "1px solid #2a2a3a",
                  backgroundColor: "transparent",
                  borderRadius: "8px",
                },
                card: { backgroundColor: "transparent", boxShadow: "none" },
                formFieldLabel: { color: "#94a3b8", fontSize: "12px" },
                identityPreviewText: { color: "#e2e8f0" },
                alternativeMethodsBlockButton: {
                  border: "1px solid #2a2a3a",
                  color: "#94a3b8",
                  borderRadius: "8px",
                },
              },
              variables: {
                colorPrimary: brand.primary.DEFAULT,
                colorBackground: color.surface.DEFAULT,
                colorForeground: color.text.primary,
                colorMutedForeground: color.text.secondary,
                colorInput: "#03050a",
                colorInputForeground: color.text.primary,
                borderRadius: "8px",
                fontFamily: "system-ui, -apple-system, sans-serif",
              },
            }}
          />
        </div>

        <div className="text-center mt-5">
          <Link
            href="/"
            className="text-[11px] opacity-70 hover:opacity-100 transition-opacity"
            style={{ color: "#94a3b8", textDecoration: "none" }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" style={{ backgroundColor: "#03050a" }} />}>
      <SignInContent />
    </Suspense>
  );
}
