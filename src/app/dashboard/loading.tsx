export default function DashboardLoading() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#0a0a12] text-[#e0e0e0]">
      <div className="text-center">
        <div className="text-3xl mb-4 animate-pulse">⚡</div>
        <div className="text-xs font-bold tracking-[0.15em] uppercase text-[#94a3b8] animate-pulse">
          Loading Dashboard...
        </div>
        <div className="mt-4 w-48 h-1 mx-auto rounded-full bg-[#1a1a24] border border-[#2a2a3a]">
          <div className="h-full rounded-full animate-[loadingBar_1.5s_ease-in-out_infinite] bg-cyan-400 w-[30%]" />
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
