"use client";

import { useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setStatus("error");
      setMessage("Please complete the Turnstile challenge.");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, turnstileToken: token }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || `Signup failed (${res.status})`);
      } else {
        setStatus("ok");
        setMessage("Signup passed bot protection. Replace the TODO in the route with your auth logic.");
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <main className="min-h-screen bg-[#060410] text-white flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-[#3b4773] bg-[#0b1020f0] p-6 shadow-xl"
      >
        <h1 className="text-xl font-black mb-4">Create account</h1>

        <label className="block text-xs font-bold mb-1.5 opacity-80">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-lg bg-white/5 border border-[#3b4773] px-3 py-2 text-sm mb-4 outline-none focus:border-[#B6FF4A]"
        />

        <label className="block text-xs font-bold mb-1.5 opacity-80">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-lg bg-white/5 border border-[#3b4773] px-3 py-2 text-sm mb-4 outline-none focus:border-[#B6FF4A]"
        />

        <div className="mb-4">
          <TurnstileWidget onVerify={setToken} />
        </div>

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded-lg bg-[#B6FF4A] text-black font-black py-2.5 text-sm transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
        >
          {status === "loading" ? "Checking..." : "Sign up"}
        </button>

        {message && (
          <p
            className={`mt-4 text-center text-xs font-medium ${
              status === "ok" ? "text-[#B6FF4A]" : "text-red-400"
            }`}
          >
            {message}
          </p>
        )}
      </form>
    </main>
  );
}
