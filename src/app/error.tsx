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
    console.error("App Error:", error);
  }, [error]);

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "#0a0a0f", color: "#00ff41", fontFamily: "monospace" }}
    >
      <div className="max-w-md w-full border-2 p-8" style={{ borderColor: "#ff00ff", backgroundColor: "#1a0a2e" }}>
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">💥</div>
          <h1 className="text-lg font-bold tracking-widest uppercase" style={{ color: "#00ffff" }}>
            SYSTEM FAILURE
          </h1>
          <p className="text-xs mt-2 opacity-80">
            An unexpected error occurred in the neural network.
          </p>
        </div>

        <div className="border p-3 mb-6 text-[10px] font-mono break-all opacity-70" style={{ borderColor: "#ff00ff", backgroundColor: "#0a0a0f" }}>
          {error.digest || error.message || "Unknown error"}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-xs font-bold border-2 hover:scale-105 transition-transform"
            style={{ borderColor: "#00ff41", color: "#00ff41", backgroundColor: "transparent" }}
          >
            🔄 RETRY
          </button>
          <Link
            href="/"
            className="px-4 py-2 text-xs font-bold border-2 hover:scale-105 transition-transform"
            style={{ borderColor: "#ff0080", color: "#ff0080", backgroundColor: "transparent", textDecoration: "none" }}
          >
            ← HOME
          </Link>
        </div>
      </div>
    </div>
  );
}
