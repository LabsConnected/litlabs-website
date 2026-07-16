export default function Loading() {
  return (
    <div
      className="min-h-dvh flex items-center justify-center"
      style={{ backgroundColor: "#0f0f14", color: "#e2e8f0" }}
    >
      <div className="text-center">
        <div className="text-3xl mb-4 animate-pulse">⚡</div>
        <div className="text-xs font-bold tracking-[0.15em] uppercase animate-pulse" style={{ color: "#94a3b8" }}>
          Loading...
        </div>
        <div className="mt-4 w-48 h-1 mx-auto rounded-full" style={{ backgroundColor: "#1a1a24", border: "1px solid #2a2a3a" }}>
          <div className="h-full rounded-full animate-[loadingBar_1.5s_ease-in-out_infinite]" style={{ backgroundColor: "#6366f1", width: "30%" }} />
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
