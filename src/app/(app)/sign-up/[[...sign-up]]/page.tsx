"use client";

import { brand, color } from "@/lib/design/litt-tokens";
import { BrandLogo } from "@/components/branding/BrandLogo";
import { SignUp } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { getSafeRedirectUrl } from "@/lib/safe-redirect-url";
import { SignupTracker } from "../SignupTracker";
import {
  formatBits,
  getPlanCreditAllowance,
} from "@/config/plan-entitlements";

/**
 * Mirrors /sign-in: preserves the `redirect_url` query parameter (used by
 * OAuth flows and deep links) instead of always dropping new users in
 * /studio. Validated via getSafeRedirectUrl — an unvalidated redirect_url
 * would be an open redirect.
 */
function SignUpContent() {
  const searchParams = useSearchParams();
  const redirectUrl = getSafeRedirectUrl(searchParams.get("redirect_url"));

  return (
    <div
      className="min-h-dvh flex items-center justify-center px-4 py-8"
      style={{ backgroundColor: "#03050a" }}
    >
      <SignupTracker />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <BrandLogo href="/" size={36} showText={false} variant="full" />
          </div>
          <h1
            className="text-xl font-black tracking-tight mb-1"
            style={{ color: "#e2e8f0" }}
          >
            Create your free LiTT account
          </h1>
          <p className="text-xs opacity-70" style={{ color: "#94a3b8" }}>
            Start with {formatBits(getPlanCreditAllowance("starter"))} credits. No credit card required.
          </p>
          <p
            className="text-[11px] mt-2 leading-relaxed opacity-60"
            style={{ color: "#94a3b8" }}
          >
            Verify your email, land in Studio, and give LiTT your first
            mission — you&apos;ll be building in under two minutes.
          </p>
        </div>

        <div
          className="rounded-xl p-1"
          style={{ backgroundColor: color.surface.DEFAULT, border: `1px solid ${color.border.DEFAULT}` }}
        >
          <SignUp
            forceRedirectUrl={redirectUrl}
            fallbackRedirectUrl="/studio"
            signInUrl="/sign-in"
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

        <div className="text-center mt-5 space-y-2">
          <p className="text-[11px] opacity-60" style={{ color: "#94a3b8" }}>
            By signing up you agree to our{" "}
            <Link
              href="/terms"
              className="hover:opacity-100 transition-opacity underline"
              style={{ color: "#94a3b8" }}
            >
              Terms
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="hover:opacity-100 transition-opacity underline"
              style={{ color: "#94a3b8" }}
            >
              Privacy Policy
            </Link>
            .
          </p>
          <div>
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
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh" style={{ backgroundColor: "#03050a" }} />
      }
    >
      <SignUpContent />
    </Suspense>
  );
}
