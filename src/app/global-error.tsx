"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global Error:", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Error — LiTTree Lab Studios</title>
        <meta name="description" content="An unexpected error occurred." />
      </head>
      <body style={{ backgroundColor: "#0a0a0f", color: "#00ff41", fontFamily: "monospace", margin: 0 }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ maxWidth: 480, width: "100%", border: "2px solid #ff00ff", backgroundColor: "#1a0a2e", padding: "2rem", borderRadius: 4 }}>
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>💥</div>
              <h1 style={{ color: "#00ffff", fontSize: "1.125rem", fontWeight: "bold", letterSpacing: "0.1em", textTransform: "uppercase", margin: 0 }}>
                System Failure
              </h1>
              <p style={{ fontSize: "0.75rem", marginTop: "0.5rem", opacity: 0.8 }}>
                An unexpected error occurred.
              </p>
            </div>
            <div style={{ border: "1px solid #ff00ff", backgroundColor: "#0a0a0f", padding: "0.75rem", marginBottom: "1.5rem", fontSize: "0.625rem", fontFamily: "monospace", wordBreak: "break-all", opacity: 0.7 }}>
              {error.digest || error.message || "Unknown error"}
            </div>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              <button
                onClick={reset}
                style={{ padding: "0.5rem 1rem", fontSize: "0.75rem", fontWeight: "bold", border: "2px solid #00ff41", color: "#00ff41", backgroundColor: "transparent", cursor: "pointer" }}
              >
                ↺ RETRY
              </button>
              <a
                href="/"
                style={{ padding: "0.5rem 1rem", fontSize: "0.75rem", fontWeight: "bold", border: "2px solid #ff0080", color: "#ff0080", backgroundColor: "transparent", textDecoration: "none" }}
              >
                ← HOME
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
