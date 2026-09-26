export default function MissionControlLoading() {
  return (
    <div className="min-h-dvh" style={{ background: "#0a0a0a" }}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6">
        <div className="h-5 w-40 animate-pulse rounded" style={{ background: "rgba(255,255,255,.06)" }} />
        <div className="h-9 w-64 animate-pulse rounded" style={{ background: "rgba(255,255,255,.06)" }} />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-2xl border"
            style={{
              background: "rgba(18,18,21,.6)",
              borderColor: "rgba(255,255,255,.06)",
            }}
          />
        ))}
      </main>
    </div>
  );
}
