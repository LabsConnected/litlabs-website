import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404 — Page Not Found | LiTree LabStudios",
};

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "#0f0f14", color: "#e2e8f0" }}
    >
      <div className="max-w-md w-full rounded-xl p-8" style={{ border: "1px solid #2a2a3a", backgroundColor: "#1a1a24" }}>
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">👾</div>
          <h1 className="text-3xl font-bold tracking-tight mb-2" style={{ color: "#e2e8f0" }}>
            404
          </h1>
          <p className="text-xs opacity-60">
            Page Not Found
          </p>
        </div>

        <p className="text-xs text-center mb-6 opacity-60 leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex gap-3 justify-center">
          <Link
            href="/"
            className="px-4 py-2 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "#6366f1", color: "#fff", textDecoration: "none" }}
          >
            ← Back to Home
          </Link>
          <Link
            href="/marketplace"
            className="px-4 py-2 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "transparent", color: "#94a3b8", border: "1px solid #2a2a3a", textDecoration: "none" }}
          >
            Marketplace →
          </Link>
        </div>
      </div>
    </div>
  );
}
