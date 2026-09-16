import Link from "next/link";

export const dynamic = "force-dynamic";

// Community profiles are not backed by real data yet. Previously this page
// fabricated a plausible-looking person for ANY username (invented bio,
// follower counts, verified badge, website, activity). That was dishonest —
// every username now gets this honest empty state until the real
// database-backed profiles ship (social-mission Phase 2).
export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const handle = Array.isArray(username) ? username[0] : username;

  return (
    <div
      className="flex min-h-dvh items-center justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-16"
      style={{ backgroundColor: "#0a0a12", color: "#e0e0ff" }}
    >
      <div
        className="w-full max-w-md rounded-xl p-8 text-center"
        style={{ border: "1px solid #2a2a45", backgroundColor: "#151520" }}
      >
        <div className="mb-4 text-5xl" aria-hidden>
          👤
        </div>
        <h1 className="mb-1 text-xl font-bold">@{handle}</h1>
        <p className="mb-2 text-sm font-semibold" style={{ color: "#00f0ff" }}>
          This profile doesn&apos;t exist yet.
        </p>
        <p className="mb-6 text-xs leading-relaxed" style={{ color: "#8888aa" }}>
          Community profiles are coming soon. Once they launch, this is where
          you&apos;ll find @{handle}&apos;s posts, agents, and activity.
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/discover"
            className="rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "#ff00a0",
              color: "#0a0a12",
              textDecoration: "none",
            }}
          >
            Browse Discover →
          </Link>
          <Link
            href="/studio"
            className="rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "transparent",
              color: "#8888aa",
              border: "1px solid #2a2a45",
              textDecoration: "none",
            }}
          >
            Back to Studio
          </Link>
        </div>
      </div>
    </div>
  );
}
