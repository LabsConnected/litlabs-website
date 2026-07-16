"use client";

import Link from "next/link";
import nextDynamic from "next/dynamic";

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const ClerkSignUp = clerkConfigured
  ? nextDynamic(() => import("@clerk/nextjs").then((m) => m.SignUp), { ssr: false })
  : null;

function CustomSignUp() {
  return (
    <div className="py-6 text-center">
      <p className="text-sm mb-4" style={{ color: "#e2e8f0" }}>
        New accounts are managed through Clerk.
      </p>
      <p className="text-[12px] mb-6" style={{ color: "#94a3b8" }}>
        If Clerk is not configured, the admin account is created via
        environment variables (<code style={{ color: "#818cf8" }}>ADMIN_EMAIL</code>,
        <code style={{ color: "#818cf8" }}> ADMIN_PASSWORD_HASH</code>).
      </p>
      <Link
        href="/sign-in"
        className="inline-block rounded-lg px-4 py-2 text-sm font-bold"
        style={{
          backgroundColor: "#6366f1",
          color: "#fff",
        }}
      >
        Go to Sign In
      </Link>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <div
      className="min-h-dvh flex items-center justify-center px-4"
      style={{ backgroundColor: "#0f0f14" }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl mb-3">🚀</div>
          <h1
            className="text-xl font-black tracking-tight mb-1"
            style={{ color: "#e2e8f0" }}
          >
            LiTTree-LabStudios
          </h1>
          <p className="text-xs opacity-50" style={{ color: "#94a3b8" }}>
            Create your account to start building with AI agents
          </p>
        </div>

        <div
          className="rounded-xl p-1"
          style={{ backgroundColor: "#1a1a24", border: "1px solid #2a2a3a" }}
        >
          {clerkConfigured && ClerkSignUp ? (
            <ClerkSignUp
              fallbackRedirectUrl="/studio"
              signInUrl="/sign-in"
              appearance={{
                elements: {
                  formButtonPrimary: {
                    backgroundColor: "#6366f1",
                    color: "#fff",
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
                  footerActionLink: { color: "#818cf8" },
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
                  colorPrimary: "#6366f1",
                  colorBackground: "#1a1a24",
                  colorText: "#e2e8f0",
                  colorTextSecondary: "#94a3b8",
                  colorInputBackground: "#0f0f14",
                  colorInputText: "#e2e8f0",
                  borderRadius: "8px",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                },
              }}
            />
          ) : (
            <CustomSignUp />
          )}
        </div>

        <div className="text-center mt-5">
          <Link
            href="/"
            className="text-[11px] opacity-50 hover:opacity-80 transition-opacity"
            style={{ color: "#94a3b8", textDecoration: "none" }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}