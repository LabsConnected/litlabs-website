export default function Loading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#0a0a0f", color: "#00ff41", fontFamily: "monospace" }}
    >
      <div className="text-center">
        <div className="text-3xl mb-4 animate-pulse">⚡</div>
        <div className="text-xs font-bold tracking-[0.3em] uppercase animate-pulse" style={{ color: "#00ffff" }}>
          Loading Neural Grid...
        </div>
        <div className="mt-4 w-48 h-1 mx-auto" style={{ backgroundColor: "#1a0a2e", border: "1px solid #ff00ff" }}>
          <div className="h-full animate-[loadingBar_1.5s_ease-in-out_infinite]" style={{ backgroundColor: "#00ff41", width: "30%" }} />
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
