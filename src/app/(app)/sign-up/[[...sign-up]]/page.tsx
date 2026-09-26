import { brand, color } from "@/lib/design/litt-tokens";
import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { SignupTracker } from "../SignupTracker";

export default function SignUpPage() {
  return (
    <div
      className="min-h-dvh flex items-center justify-center px-4 py-8"
      style={{ backgroundColor: "#0f0f14" }}
    >
      <SignupTracker />
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1
            className="text-xl font-black tracking-tight mb-1"
            style={{ color: "#e2e8f0" }}
          >
            Create your free LiTT account
          </h1>
          <p className="text-xs opacity-70" style={{ color: "#94a3b8" }}>
            Start with 500 credits. No credit card required.
          </p>
          <p
            className="text-[11px] mt-2 leading-relaxed opacity-60"
            style={{ color: "#94a3b8" }}
          >
            Verify your email, land in Studio, and give LiTT your first
            mission — you&apos;ll be building in under two minutes.
          </p>
          <p
            className="text-[11px] mt-2 leading-relaxed opacity-60"
            style={{ color: "#94a3b8" }}
          >
            LiTT is for people 13 and older. Anyone under 18 should use it
            with a parent or legal guardian. Paid features and business
            services may require an adult account holder.
          </p>
        </div>

        <div
          className="rounded-xl p-1"
          style={{ backgroundColor: "#1a1a24", border: "1px solid #2a2a3a" }}
        >
          <SignUp
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
