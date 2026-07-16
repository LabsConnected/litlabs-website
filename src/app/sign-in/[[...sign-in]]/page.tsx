"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import nextDynamic from "next/dynamic";

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const ClerkSignIn = clerkConfigured
  ? nextDynamic(() => import("@clerk/nextjs").then((m) => m.SignIn), { ssr: false })
  : null;

function CustomSignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect_url") || "/studio";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid credentials");
        setLoading(false);
        return;
      }
      router.push(redirectUrl);
      router.refresh();
    } catch {
      setError("Network error — try again");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          className="block text-[11px] font-bold mb-1.5"
          style={{ color: "#94a3b8" }}
        >
          Email or Username
        </label>
        <input
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
          style={{
            backgroundColor: "#0f0f14",
            border: "1px solid #2a2a3a",
            color: "#e2e8f0",
          }}
          placeholder="admin@litlabs.net"
        />
      </div>
      <div>
        <label
          className="block text-[11px] font-bold mb-1.5"
          style={{ color: "#94a3b8" }}
        >
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
          style={{
            backgroundColor: "#0f0f14",
            border: "1px solid #2a2a3a",
            color: "#e2e8f0",
          }}
          placeholder="••••••••"
        />
      </div>
      {error && (
        <div
          className="rounded-lg px-3 py-2 text-[11px] font-medium"
          style={{
            backgroundColor: "#ef444422",
            border: "1px solid #ef444455",
            color: "#fca5a5",
          }}
        >
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg py-2.5 text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
        style={{
          backgroundColor: "#6366f1",
          color: "#fff",
        }}
      >
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}

export default function SignInPage() {
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
            Sign in to your AI workspace
          </p>
        </div>

        <div
          className="rounded-xl p-1"
          style={{ backgroundColor: "#1a1a24", border: "1px solid #2a2a3a" }}
        >
          {clerkConfigured && ClerkSignIn ? (
            <ClerkSignIn
              fallbackRedirectUrl="/studio"
              signUpUrl="/sign-up"
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
            <CustomSignIn />
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