"use client";

import { brand, color } from "@/lib/design/litt-tokens";
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
      style={{ backgroundColor: "#f6f9f1" }}
    >
      <SignupTracker />
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1
            className="text-xl font-black tracking-tight mb-1"
            style={{ color: "#0e1510" }}
          >
            Create your free LiTT account
          </h1>
          <p className="text-xs opacity-70" style={{ color: "#63745f" }}>
            Start with {formatBits(getPlanCreditAllowance("starter"))} credits. No credit card required.
          </p>
          <p
            className="text-[11px] mt-2 leading-relaxed opacity-60"
            style={{ color: "#63745f" }}
          >
            Verify your email, land in Studio, and give LiTT your first
            mission — you&apos;ll be building in under two minutes.
          </p>
        </div>

        <div
          className="rounded-xl p-1"
          style={{ backgroundColor: "#ffffff", border: "1px solid #cfdec4" }}
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
                  backgroundColor: "#f6f9f1",
                  border: "1px solid #cfdec4",
                  color: "#0e1510",
                  borderRadius: "8px",
                },
                footerActionLink: { color: brand.primary.DEFAULT },
                headerTitle: { color: "#0e1510" },
                headerSubtitle: { color: "#63745f" },
                socialButtonsBlockButton: {
                  border: "1px solid #cfdec4",
                  backgroundColor: "transparent",
                  borderRadius: "8px",
                },
                card: { backgroundColor: "transparent", boxShadow: "none" },
                formFieldLabel: { color: "#63745f", fontSize: "12px" },
                identityPreviewText: { color: "#0e1510" },
                alternativeMethodsBlockButton: {
                  border: "1px solid #cfdec4",
                  color: "#63745f",
                  borderRadius: "8px",
                },
              },
              variables: {
                colorPrimary: brand.primary.DEFAULT,
                colorBackground: "#ffffff",
                colorForeground: "#0e1510",
                colorMutedForeground: "#63745f",
                colorInput: "#f6f9f1",
                colorInputForeground: "#0e1510",
                borderRadius: "8px",
                fontFamily: "system-ui, -apple-system, sans-serif",
              },
            }}
          />
        </div>

        <div className="text-center mt-5 space-y-2">
          <p className="text-[11px] opacity-60" style={{ color: "#63745f" }}>
            By signing up you agree to our{" "}
            <Link
              href="/terms"
              className="hover:opacity-100 transition-opacity underline"
              style={{ color: "#63745f" }}
            >
              Terms
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="hover:opacity-100 transition-opacity underline"
              style={{ color: "#63745f" }}
            >
              Privacy Policy
            </Link>
            .
          </p>
          <div>
            <Link
              href="/"
              className="text-[11px] opacity-70 hover:opacity-100 transition-opacity"
              style={{ color: "#63745f", textDecoration: "none" }}
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
        <div className="min-h-dvh" style={{ backgroundColor: "#f6f9f1" }} />
      }
    >
      <SignUpContent />
    </Suspense>
  );
}
