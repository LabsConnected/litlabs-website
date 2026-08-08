"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export function RouteError({
  error,
  reset,
  label = "This section",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  label?: string;
}) {
  useEffect(() => {
    console.error(`${label} error:`, error);
    Sentry.captureException(error, { tags: { route: label } });
  }, [error, label]);

  return (
    <div
      className="flex min-h-[60vh] items-center justify-center px-4"
      style={{ backgroundColor: "#0f0f14", color: "#e2e8f0" }}
    >
      <div
        className="w-full max-w-md rounded-xl p-8"
        style={{ border: "1px solid #2a2a3a", backgroundColor: "#1a1a24" }}
      >
        <div className="mb-6 text-center">
          <div className="mb-2 text-4xl">💥</div>
          <h1
            className="text-lg font-bold tracking-tight"
            style={{ color: "#e2e8f0" }}
          >
            {label} hit a snag
          </h1>
          <p className="mt-2 text-xs opacity-60">
            An error occurred while loading this section.
          </p>
        </div>

        <div
          className="mb-6 break-all rounded-lg p-3 font-mono text-[10px] opacity-70"
          style={{ backgroundColor: "#0f0f14", border: "1px solid #2a2a3a" }}
        >
          {error.digest || error.message || "Unknown error"}
        </div>

        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="cursor-pointer rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#6366f1", color: "#fff" }}
          >
            Try Again
          </button>
          <Link
            href="/"
            className="rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90"
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
