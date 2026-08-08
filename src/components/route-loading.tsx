export function RouteLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      style={{ backgroundColor: "#0f0f14", color: "#e2e8f0" }}
    >
      <div className="text-center">
        <div className="mb-4 animate-pulse text-3xl">⚡</div>
        <div
          className="animate-pulse text-xs font-bold uppercase tracking-[0.15em]"
          style={{ color: "#94a3b8" }}
        >
          {label}...
        </div>
        <div
          className="mx-auto mt-4 h-1 w-48 rounded-full"
          style={{ backgroundColor: "#1a1a24", border: "1px solid #2a2a3a" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              backgroundColor: "#6366f1",
              width: "30%",
              animation: "loadingBar 1.5s ease-in-out infinite",
            }}
          />
        </div>
        <style>{`
          @keyframes loadingBar {
            0% { transform: translateX(-100%); width: 30%; }
            50% { width: 50%; }
            100% { transform: translateX(340%); width: 30%; }
          }
        `}</style>
      </div>
    </div>
  );
}
