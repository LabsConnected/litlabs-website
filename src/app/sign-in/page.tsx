"use client";

import { brand, color } from "@/lib/design/litt-tokens";

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
      style={{ backgroundColor: "#0f0f14" }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1
            className="text-xl font-black tracking-tight mb-1"
            style={{ color: "#e2e8f0" }}
          >
            LiTT
          </h1>
          <p className="text-xs opacity-70" style={{ color: "#94a3b8" }}>
            Sign in to your AI workspace
          </p>
        </div>

        <div
          className="rounded-xl p-1"
          style={{ backgroundColor: "#1a1a24", border: "1px solid #2a2a3a" }}
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
                  backgroundColor: "#0f0f14",
                  border: "1px solid #2a2a3a",
                  color: "#e2e8f0",
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
                colorBackground: "#1a1a24",
                colorForeground: "#e2e8f0",
                colorMutedForeground: "#94a3b8",
                colorInput: "#0f0f14",
                colorInputForeground: "#e2e8f0",
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
    <Suspense fallback={<div className="min-h-dvh" style={{ backgroundColor: "#0f0f14" }} />}>
      <SignInContent />
    </Suspense>
  );
}
