"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App Error:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      className="min-h-dvh flex items-center justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-16"
      style={{ backgroundColor: "#f6f9f1", color: "#0e1510" }}
    >
      <div
        className="max-w-md w-full rounded-xl p-8"
        style={{ border: "1px solid #cfdec4", backgroundColor: "#ffffff" }}
      >
        <div className="text-center mb-6">
          <h1
            className="text-lg font-bold tracking-tight"
            style={{ color: "#0e1510" }}
          >
            Something went wrong
          </h1>
          <p className="text-xs mt-2 opacity-60">
            An unexpected error occurred. Try again or return home.
          </p>
        </div>

        <div
          className="rounded-lg p-3 mb-6 text-[10px] font-mono break-all opacity-70"
          style={{ backgroundColor: "#f6f9f1", border: "1px solid #cfdec4" }}
        >
          {error.digest || error.message || "Unknown error"}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
            style={{ backgroundColor: "var(--color-accent)", color: "var(--color-on-accent)" }}
          >
            Try Again
          </button>
          <Link
            href="/"
            className="px-4 py-2 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
            style={{
              backgroundColor: "transparent",
              color: "#63745f",
              border: "1px solid #cfdec4",
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
