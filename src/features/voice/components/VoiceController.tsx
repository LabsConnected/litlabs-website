"use client";

import { useCallback } from "react";
import { VoiceOrb } from "@/features/voice/components/VoiceOrb";
import { VoiceStatus } from "@/features/voice/components/VoiceStatus";
import { AgentVoiceSelector } from "@/features/voice/components/AgentVoiceSelector";
import { useInworldSession } from "@/features/voice/hooks/useInworldSession";

interface VoiceControllerProps {
  onTranscript?: (text: string, final: boolean) => void;
  onAgentText?: (text: string) => void;
  showSelector?: boolean;
  showStatus?: boolean;
}

export function VoiceController({
  onTranscript,
  onAgentText,
  showSelector = false,
  showStatus = true,
}: VoiceControllerProps) {
  const { startListening, stopListening, interrupt, isConnected, error } =
    useInworldSession({
      onTranscript,
      onAgentText,
    });

  const handleStart = useCallback(async () => {
    await startListening();
  }, [startListening]);

  const handleStop = useCallback(() => {
    stopListening();
  }, [stopListening]);

  const handleInterrupt = useCallback(() => {
    interrupt();
  }, [interrupt]);

  return (
    <div className="flex flex-col items-center gap-3">
      <VoiceOrb
        onStart={handleStart}
        onStop={handleStop}
        onInterrupt={handleInterrupt}
      />
      {showStatus && <VoiceStatus />}
      {showSelector && <AgentVoiceSelector compact />}
      {error && (
        <div className="max-w-xs text-center text-xs text-red-400">
          {error}
        </div>
      )}
      {!isConnected && !error && (
        <div className="text-xs opacity-30">
          Tap to connect
        </div>
      )}
    </div>
  );
}
