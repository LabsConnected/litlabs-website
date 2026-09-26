"use client";

export default function MissionControlError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ background: "#0a0a0a" }}
    >
      <p className="text-lg font-bold" style={{ color: "#fafafa" }}>
        Mission control couldn&rsquo;t load.
      </p>
      <p className="max-w-md text-sm" style={{ color: "#a1a1aa" }}>
        The status feed hit a snag. Your work in Studio is unaffected.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-xl px-5 py-2.5 text-sm font-bold transition hover:brightness-110"
        style={{ background: "#a8ff2f", color: "#0c1204" }}
      >
        Try again
      </button>
    </div>
  );
}
