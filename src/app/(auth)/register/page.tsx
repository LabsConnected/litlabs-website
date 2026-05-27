"use client";
import { useState } from "react";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (result?.envVars) {
    return (
      <AuthLayout>
        <h2 className="font-heading text-xl font-semibold mb-4 text-center text-neon-cyan">Admin Account Ready</h2>
        <p className="text-text-secondary text-sm mb-4">Add these environment variables to your Vercel project:</p>
        <div className="space-y-3">
          {Object.entries(result.envVars).map(([key, value]) => (
            <div key={key}>
              <label className="block text-text-muted text-xs font-code mb-1">{key}</label>
              <div className="flex gap-2">
                <input className="input font-code text-xs" value={value as string} readOnly />
                <button className="btn-primary text-xs px-3" onClick={() => navigator.clipboard.writeText(value as string)}>Copy</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 rounded-lg bg-neon-gold/10 border border-neon-gold/20 text-xs text-neon-gold">
          Go to Vercel Dashboard → Project → Settings → Environment Variables, add all three, then redeploy.
        </div>
        <p className="text-text-muted text-sm text-center mt-4">
          <Link href="/login" className="text-neon-cyan hover:underline">Back to Login</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="font-heading text-xl font-semibold mb-6 text-center">Create Admin Account</h2>
      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 text-sm mb-4">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-text-secondary text-sm mb-1">Name</label>
          <input className="input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div>
          <label className="block text-text-secondary text-sm mb-1">Email</label>
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />
        </div>
        <div>
          <label className="block text-text-secondary text-sm mb-1">Password</label>
          <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="Min 8 characters" />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Setting up..." : "Create Admin Account"}
        </button>
      </form>
      <p className="text-text-muted text-sm text-center mt-4">
        Already set up? <Link href="/login" className="text-neon-cyan hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
