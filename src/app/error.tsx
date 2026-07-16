"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log in all environments so Vercel logs capture client-side errors
    console.error("App Error:", error);
  }, [error]);

  return (
    <div
      className="min-h-dvh flex items-center justify-center px-4"
      style={{ backgroundColor: "#0f0f14", color: "#e2e8f0" }}
    >
      <div
        className="max-w-md w-full rounded-xl p-8"
        style={{ border: "1px solid #2a2a3a", backgroundColor: "#1a1a24" }}
      >
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">💥</div>
          <h1
            className="text-lg font-bold tracking-tight"
            style={{ color: "#e2e8f0" }}
          >
            Something went wrong
          </h1>
          <p className="text-xs mt-2 opacity-60">
            An unexpected error occurred. Try again or return home.
          </p>
        </div>

        <div
          className="rounded-lg p-3 mb-6 text-[10px] font-mono break-all opacity-70"
          style={{ backgroundColor: "#0f0f14", border: "1px solid #2a2a3a" }}
        >
          {error.digest || error.message || "Unknown error"}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
            style={{ backgroundColor: "#6366f1", color: "#fff" }}
          >
            Try Again
          </button>
          <Link
            href="/"
            className="px-4 py-2 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
            style={{
              backgroundColor: "transparent",
              color: "#94a3b8",
              border: "1px solid #2a2a3a",
              textDecoration: "none",
            }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
