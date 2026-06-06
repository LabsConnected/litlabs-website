import Link from "next/link";

export const metadata = {
  title: "404 — Sector Not Found | LiTTree Lab Studios",
};

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "#0a0a0f", color: "#00ff41", fontFamily: "monospace" }}
    >
      <div className="max-w-md w-full border-2 p-8" style={{ borderColor: "#ff00ff", backgroundColor: "#1a0a2e" }}>
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">👾</div>
          <h1 className="text-3xl font-bold tracking-widest uppercase mb-2" style={{ color: "#00ffff" }}>
            404
          </h1>
          <p className="text-xs uppercase tracking-widest opacity-80">
            Sector Not Found
          </p>
        </div>

        <p className="text-xs text-center mb-6 opacity-70 leading-relaxed">
          The requested coordinate does not exist in the LiTTree neural grid. The agent may have been decommissioned or the URL was corrupted during transmission.
        </p>

        <div className="flex gap-3 justify-center">
          <Link
            href="/"
            className="px-4 py-2 text-xs font-bold border-2 hover:scale-105 transition-transform"
            style={{ borderColor: "#00ff41", color: "#00ff41", backgroundColor: "transparent", textDecoration: "none" }}
          >
            ← RETURN TO BASE
          </Link>
          <Link
            href="/marketplace"
            className="px-4 py-2 text-xs font-bold border-2 hover:scale-105 transition-transform"
            style={{ borderColor: "#ff0080", color: "#ff0080", backgroundColor: "transparent", textDecoration: "none" }}
          >
            MARKETPLACE →
          </Link>
        </div>
      </div>
    </div>
  );
}
