"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";

interface GameEmulatorProps {
  romUrl: string;
  platform: "nes" | "snes" | "genesis" | "gb" | "gba" | "html5";
  onError?: (error: string) => void;
}

interface NESInstance {
  loadROM: (rom: string) => void;
  frame: () => void;
  buttonDown: (player: number, button: number) => void;
  buttonUp: (player: number, button: number) => void;
  reset: () => void;
}

// NES Key Mappings
const NES_KEYS: Record<string, number> = {
  // Player 1
  ArrowUp: 0x0101, // UP
  ArrowDown: 0x0102, // DOWN
  ArrowLeft: 0x0103, // LEFT
  ArrowRight: 0x0104, // RIGHT
  z: 0x0105, // B
  x: 0x0106, // A
  Enter: 0x0107, // START
  Shift: 0x0108, // SELECT
  // Alternative keys
  a: 0x0105, // B (alt)
  s: 0x0106, // A (alt)
  " ": 0x0107, // START (alt)
  c: 0x0108, // SELECT (alt)
};

export default function GameEmulator({
  romUrl,
  platform,
  onError,
}: GameEmulatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedColors: T } = useTheme();
  const [isLoading, setIsLoading] = useState(() => platform === "nes");
  const [error, setError] = useState<string | null>(() =>
    platform === "nes"
      ? null
      : `${platform.toUpperCase()} emulator coming soon. Try NES games!`,
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const playingRef = useRef(isPlaying);
  const nesRef = useRef<NESInstance | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  // Initialize emulator
  useEffect(() => {
    let isMounted = true;

    const initEmulator = async () => {
      if (!canvasRef.current) return;

      try {
        setIsLoading(true);

        // Dynamically import jsnes
        const { default: jsnes } = await import("jsnes");

        if (!isMounted) return;

        // Create NES instance
        const nes = new jsnes.NES({
          onFrame: (frameBuffer: number[]) => {
            if (!canvasRef.current) return;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // Convert frame buffer to ImageData
            const imageData = ctx.createImageData(256, 240);
            for (let i = 0; i < frameBuffer.length; i++) {
              const pixel = frameBuffer[i];
              imageData.data[i * 4] = pixel & 0xff;
              imageData.data[i * 4 + 1] = (pixel >> 8) & 0xff;
              imageData.data[i * 4 + 2] = (pixel >> 16) & 0xff;
              imageData.data[i * 4 + 3] = 255;
            }
            ctx.putImageData(imageData, 0, 0);
          },
          onAudioSample: () => {
            // Audio handling - could connect to Web Audio API
          },
        });

        nesRef.current = nes;

        // Load ROM
        const response = await fetch(romUrl);
        if (!response.ok) {
          throw new Error(
            `ROM not found: ${romUrl}. Place ROM files in /public/roms/ directory.`,
          );
        }

        const romData = await response.arrayBuffer();
        const romString = String.fromCharCode.apply(
          null,
          Array.from(new Uint8Array(romData)),
        );

        nes.loadROM(romString);

        if (!isMounted) return;

        setIsLoading(false);
        setIsPlaying(true);

        // Start emulation loop
        const frame = () => {
          if (nesRef.current && playingRef.current) {
            nesRef.current.frame();
          }
          animationRef.current = requestAnimationFrame(frame);
        };
        animationRef.current = requestAnimationFrame(frame);
      } catch (err) {
        if (!isMounted) return;
        const errorMsg =
          err instanceof Error ? err.message : "Failed to load emulator";
        setError(errorMsg);
        setIsLoading(false);
        onError?.(errorMsg);
      }
    };

    if (platform === "nes") {
      initEmulator();
    }

    return () => {
      isMounted = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (nesRef.current) {
        nesRef.current = null;
      }
    };
  }, [romUrl, platform, onError]);

  // Keyboard controls
  useEffect(() => {
    if (!nesRef.current || !isPlaying) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const keyCode = NES_KEYS[e.key];
      if (keyCode && nesRef.current) {
        e.preventDefault();
        nesRef.current.buttonDown(1, keyCode & 0xff);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const keyCode = NES_KEYS[e.key];
      if (keyCode && nesRef.current) {
        e.preventDefault();
        nesRef.current.buttonUp(1, keyCode & 0xff);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isPlaying]);

  const handlePauseResume = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const handleReset = useCallback(() => {
    if (nesRef.current) {
      nesRef.current.reset();
    }
  }, []);

  if (platform !== "nes") {
    return (
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center"
        style={{ backgroundColor: "#000" }}
      >
        <div className="text-center">
          <div className="text-4xl mb-4">🎮</div>
          <p className="text-sm opacity-60 mb-2">
            {platform.toUpperCase()} emulator coming soon
          </p>
          <p className="text-[10px] opacity-40">Try our NES games for now!</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center"
        style={{ backgroundColor: "#000" }}
      >
        <div className="text-center p-4">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-sm opacity-60 mb-2">{error}</p>
          <p className="text-[10px] opacity-40 max-w-xs">
            To play NES games, add .nes ROM files to /public/roms/ directory.
            <br />
            Controls: Arrow keys = D-pad, Z = B, X = A, Enter = Start, Shift =
            Select
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col"
      style={{ backgroundColor: "#000" }}
    >
      {/* Game Canvas */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl mb-2 animate-pulse">🎮</div>
              <p className="text-sm opacity-60">Loading emulator...</p>
            </div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          width={256}
          height={240}
          className="max-w-full max-h-full object-contain"
          style={{
            imageRendering: "pixelated",
            display: isLoading ? "none" : "block",
          }}
        />
      </div>

      {/* Controls Bar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-t"
        style={{
          backgroundColor: T.boxBg,
          borderColor: T.borderColor,
        }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={handlePauseResume}
            className="px-3 py-1 rounded text-xs font-bold transition-all hover:opacity-80"
            style={{
              backgroundColor: T.accentColor,
              color: T.bgColor,
            }}
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1 rounded text-xs font-bold transition-all hover:opacity-80"
            style={{
              backgroundColor: T.borderColor + "40",
              color: T.textColor,
            }}
          >
            ↺ Reset
          </button>
        </div>

        <div
          className="flex items-center gap-3 text-[10px]"
          style={{ color: T.textMuted }}
        >
          <span>⬆⬇⬅➡ D-pad</span>
          <span>Z=B X=A</span>
          <span>↵=Start ⇧=Select</span>
        </div>
      </div>
    </div>
  );
}
