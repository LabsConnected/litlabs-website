"use client";

import { useStudioStore } from "@/stores/useStudioStore";

export function WorkspaceCanvas() {
  const { activeMode, setMode } = useStudioStore();

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#07050a]">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8b5cf6]/5 blur-[120px]" />
        <div className="absolute right-1/4 bottom-1/4 h-64 w-64 rounded-full bg-[#25f4ff]/5 blur-[100px]" />
      </div>

      {/* Grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />

      {/* Mode tabs */}
      <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/5 bg-[#0d0a12]/80 p-1 backdrop-blur-xl">
        {(["canvas", "code", "chat", "preview", "workflow", "media"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setMode(mode)}
            className={`rounded-lg px-3 py-1.5 text-xs capitalize transition-colors ${
              activeMode === mode
                ? "bg-[#8b5cf6]/15 text-[#8b5cf6]"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Canvas content */}
      <div className="relative z-10 flex h-full w-full items-center justify-center">
        {activeMode === "canvas" && (
          <div className="text-center">
            <div className="text-2xl font-light text-white/20">Infinite Canvas</div>
            <p className="mt-2 text-sm text-white/10">Pan, zoom, and build your project visually</p>
          </div>
        )}
        {activeMode === "code" && (
          <div className="text-center">
            <div className="text-2xl font-light text-white/20">Code Editor</div>
            <p className="mt-2 text-sm text-white/10">Monaco editor with file tree</p>
          </div>
        )}
        {activeMode === "chat" && (
          <div className="text-center">
            <div className="text-2xl font-light text-white/20">LiTT Chat</div>
            <p className="mt-2 text-sm text-white/10">Talk to LiTT about anything</p>
          </div>
        )}
        {activeMode === "preview" && (
          <div className="text-center">
            <div className="text-2xl font-light text-white/20">Live Preview</div>
            <p className="mt-2 text-sm text-white/10">See your project in real-time</p>
          </div>
        )}
        {activeMode === "workflow" && (
          <div className="text-center">
            <div className="text-2xl font-light text-white/20">Workflow Builder</div>
            <p className="mt-2 text-sm text-white/10">Visual automation with triggers and actions</p>
          </div>
        )}
        {activeMode === "media" && (
          <div className="text-center">
            <div className="text-2xl font-light text-white/20">Media Studio</div>
            <p className="mt-2 text-sm text-white/10">Timeline, tracks, and assets</p>
          </div>
        )}
      </div>
    </div>
  );
}
