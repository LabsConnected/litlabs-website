"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error("Global Error:", error);
    }
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Error — LiTTree Lab Studios</title>
        <meta name="description" content="An unexpected error occurred." />
      </head>
      <body
        style={{
          backgroundColor: "#0f0f14",
          color: "#e2e8f0",
          margin: 0,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              width: "100%",
              border: "1px solid #2a2a3a",
              backgroundColor: "#1a1a24",
              padding: "2rem",
              borderRadius: 12,
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>
                💥
              </div>
              <h1
                style={{
                  color: "#e2e8f0",
                  fontSize: "1.125rem",
                  fontWeight: "bold",
                  letterSpacing: "-0.01em",
                  margin: 0,
                }}
              >
                Something went wrong
              </h1>
              <p
                style={{
                  fontSize: "0.75rem",
                  marginTop: "0.5rem",
                  opacity: 0.6,
                }}
              >
                An unexpected error occurred.
              </p>
            </div>
            <div
              style={{
                border: "1px solid #2a2a3a",
                backgroundColor: "#0f0f14",
                padding: "0.75rem",
                marginBottom: "1.5rem",
                fontSize: "0.625rem",
                fontFamily: "monospace",
                wordBreak: "break-all",
                opacity: 0.7,
                borderRadius: 8,
              }}
            >
              {error.digest || error.message || "Unknown error"}
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                justifyContent: "center",
              }}
            >
              <button
                onClick={reset}
                style={{
                  padding: "0.5rem 1rem",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  borderRadius: 8,
                  backgroundColor: "#6366f1",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Try Again
              </button>
              <Link
                href="/"
                style={{
                  padding: "0.5rem 1rem",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  borderRadius: 8,
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
        </main>
      </body>
    </html>
  );
}
