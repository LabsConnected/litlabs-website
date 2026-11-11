import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404 — Page Not Found",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <div
      className="min-h-dvh flex items-center justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-16"
      style={{ backgroundColor: "#f6f9f1", color: "#0e1510" }}
    >
      <div className="max-w-md w-full rounded-xl p-8" style={{ border: "1px solid #cfdec4", backgroundColor: "#ffffff" }}>
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight mb-2" style={{ color: "#0e1510" }}>
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
            style={{ backgroundColor: "var(--color-accent)", color: "var(--color-on-accent)", textDecoration: "none" }}
          >
            ← Back to Home
          </Link>
          <Link
            href="/marketplace"
            className="px-4 py-2 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "transparent", color: "#63745f", border: "1px solid #cfdec4", textDecoration: "none" }}
          >
            Marketplace →
          </Link>
        </div>
      </div>
    </div>
  );
}
