"use client";
import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import AuthLayout from "@/components/AuthLayout";

function passwordStrength(pw: string): { label: string; color: string; pct: number } {
  if (!pw) return { label: "", color: "", pct: 0 };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2) return { label: "Weak", color: "#ff5050", pct: 33 };
  if (score <= 3) return { label: "Medium", color: "#ffd700", pct: 66 };
  return { label: "Strong", color: "#00ff88", pct: 100 };
}

export default function RegisterPage() {
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const strength = passwordStrength(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!acceptTerms) {
      setError("You must accept the Terms of Service.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.envVars) {
          setResult(data);
          return;
        }
        throw new Error(data.error);
      }
      // API returned user + auto-login
      await register(email, password, name);
    } catch (err) {
      const msg = (err as Error)?.message || "Unknown";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Success state — show env vars to copy
  if (result?.envVars) {
    const envVars = result.envVars as Record<string, string>;
    return (
      <AuthLayout>
        <h2 className="font-heading text-xl font-semibold mb-4 text-center text-neon-cyan">
          Admin Account Ready
        </h2>
        <p className="text-text-secondary text-sm mb-4">
          Add these environment variables to your Vercel project:
        </p>
        <div className="space-y-3">
          {Object.entries(envVars).map(([key, value]) => (
            <div key={key}>
              <label className="block text-text-muted text-xs font-code mb-1">{key}</label>
              <div className="flex gap-2">
                <input className="input font-code text-xs" value={value} readOnly />
                <button
                  className="btn-primary text-xs px-3"
                  onClick={() => navigator.clipboard.writeText(value)}
                >
                  Copy
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 rounded-lg bg-neon-gold/10 border border-neon-gold/20 text-xs text-neon-gold">
          Go to Vercel Dashboard → Project → Settings → Environment Variables, add all three, then
          redeploy.
        </div>
        <p className="text-text-muted text-sm text-center mt-4">
          <Link href="/login" className="text-neon-cyan hover:underline">
            Back to Login
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="font-heading text-xl font-semibold mb-1 text-center">Create Account</h2>
      <p className="text-text-muted text-sm text-center mb-6">Set up your admin workspace</p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 text-sm mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-text-secondary text-sm mb-1">Full Name</label>
          <input
            className="input"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="block text-text-secondary text-sm mb-1">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-text-secondary text-sm mb-1">Password</label>
          <div className="relative">
            <input
              className="input pr-12"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Min 8 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-neon-cyan transition-colors text-sm"
              tabIndex={-1}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {password && (
            <div className="mt-2">
              <div className="w-full h-1.5 rounded-full bg-cyber-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${strength.pct}%`, background: strength.color }}
                />
              </div>
              <p className="text-xs mt-1" style={{ color: strength.color }}>
                {strength.label}
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-text-secondary text-sm mb-1">Confirm Password</label>
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            placeholder="Re-enter password"
          />
          {confirm && password !== confirm && (
            <p className="text-red-400 text-xs mt-1">Passwords do not match</p>
          )}
        </div>

        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={e => setAcceptTerms(e.target.checked)}
            className="w-4 h-4 mt-0.5 rounded border-cyber-border bg-cyber-surface accent-neon-cyan"
          />
          <span className="text-text-secondary text-sm">
            I agree to the{" "}
            <span className="text-neon-purple hover:underline cursor-pointer">
              Terms of Service
            </span>{" "}
            and{" "}
            <span className="text-neon-purple hover:underline cursor-pointer">
              Privacy Policy
            </span>
          </span>
        </label>

        <button
          type="submit"
          className="btn-primary w-full flex items-center justify-center gap-2"
          disabled={loading}
        >
          {loading && (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {loading ? "Creating…" : "Create Account"}
        </button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-cyber-border" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-cyber-surface px-3 text-text-muted">or</span>
        </div>
      </div>

      <p className="text-text-muted text-sm text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-neon-cyan hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
