"use client";

import { useCallback } from "react";
import { useGeminiLiveVoice, type LiveStudioContext } from "../hooks/useGeminiLiveVoice";

interface LiveVoiceBarProps {
  context: LiveStudioContext;
  onInputTranscript?: (text: string, isFinal: boolean) => void;
  onOutputTranscript?: (text: string, isFinal: boolean) => void;
  onStarted?: () => void;
  onStopped?: () => void;
}

export function LiveVoiceBar({
  context,
  onInputTranscript,
  onOutputTranscript,
  onStarted,
  onStopped,
}: LiveVoiceBarProps) {
  const {
    state,
    inputTranscript,
    outputTranscript,
    micLevel,
    error,
    muted,
    start,
    stop,
    mute,
    unmute,
    interrupt,
  } = useGeminiLiveVoice({ onInputTranscript, onOutputTranscript });

  const handleStart = useCallback(async () => {
    await start(context);
    onStarted?.();
  }, [start, context, onStarted]);

  const handleStop = useCallback(() => {
    stop();
    onStopped?.();
  }, [stop, onStopped]);

  if (state === "idle" && !error) {
    return (
      <button
        onClick={handleStart}
        className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-[11px] font-bold text-cyan-200 transition hover:bg-cyan-400/10"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
        Start Live Voice
      </button>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2">
        <span className="text-[11px] font-bold text-red-300">
          {error ?? "Voice error"}
        </span>
        <button
          onClick={handleStart}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-gray-300 hover:bg-white/10"
        >
          Retry
        </button>
        <button
          onClick={handleStop}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-gray-300 hover:bg-white/10"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const labelMap: Record<string, string> = {
    connecting: "Connecting…",
    listening: "Listening live",
    thinking: "Thinking…",
    speaking: `${context.agentName} is speaking`,
    reconnecting: "Reconnecting…",
  };

  const bars = Array.from({ length: 10 });
  const level = micLevel;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-3 py-2">
      {/* Waveform */}
      <div className="flex h-7 items-end gap-[2px]">
        {bars.map((_, index) => (
          <span
            key={index}
            className="w-[2px] rounded-full bg-cyan-300 transition-all"
            style={{
              height:
                state === "speaking"
                  ? `${4 + Math.abs(Math.sin(Date.now() / 200 + index)) * 22}px`
                  : state === "listening"
                    ? `${4 + level * 24 + Math.abs(Math.sin(Date.now() / 300 + index * 0.5)) * 8}px`
                    : "4px",
            }}
          />
        ))}
      </div>

      {/* Status + captions */}
      <div className="min-w-0 flex-1">
        <strong className="block text-[10px] uppercase tracking-wider text-cyan-200">
          {labelMap[state] ?? state}
          {muted && " · Muted"}
        </strong>
        <p className="truncate text-xs text-white/65">
          {state === "speaking" && outputTranscript
            ? outputTranscript
            : inputTranscript || "Speak naturally. Pause when you finish."}
        </p>
      </div>

      {/* Controls */}
      {state === "speaking" && (
        <button
          onClick={interrupt}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] font-bold text-gray-300 hover:bg-white/10"
        >
          Interrupt
        </button>
      )}
      {state === "listening" && (
        <button
          onClick={muted ? unmute : mute}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] font-bold text-gray-300 hover:bg-white/10"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      )}
      <button
        onClick={handleStop}
        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] font-bold text-gray-300 hover:bg-white/10"
      >
        End
      </button>
    </div>
  );
}

export default LiveVoiceBar;
