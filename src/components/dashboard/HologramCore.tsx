"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";

/**
 * HologramCore
 *
 * A canvas-based holographic energy core that reacts to three input modalities:
 *
 * 1. **Voice** — when `active` is true (recording), the core pulses intensely
 *    with audio-reactive amplitude (if an AnalyserNode is provided).
 * 2. **Typing** — each keystroke sends a ripple through the core via `pulse()`.
 * 3. **Cursor** — the core's inner light follows the cursor position,
 *    creating a parallax "watching" effect.
 *
 * The visual is a layered hologram:
 * - Outer rotating ring with tick marks
 * - Middle counter-rotating ring with energy arcs
 * - Inner pulsating core sphere with radial gradient glow
 * - Particle field that drifts and reacts to activity
 * - Scan lines for CRT aesthetic
 *
 * All rendering is done on a single 2D canvas with requestAnimationFrame.
 * No external dependencies. Theme-aware via useTheme tokens.
 */

interface HologramCoreProps {
  /** When true, the core enters "listening" mode — intense pulsing */
  active?: boolean;
  /** Size in pixels (square). Default 280. */
  size?: number;
  /** Label shown below the core */
  label?: string;
  /** Whether to track global mouse movement. Default true. */
  trackCursor?: boolean;
  /** Whether to listen for global keypresses. Default true. */
  trackKeyboard?: boolean;
}

export default function HologramCore({
  active = false,
  size = 280,
  label,
  trackCursor = true,
  trackKeyboard = true,
}: HologramCoreProps) {
  const { tokens } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const activeRef = useRef(active);
  const pulseRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, hasMouse: false });
  const timeRef = useRef(0);
  const [voiceActive, setVoiceActive] = useState(active);

  /* Listen for voice events from FloatingChat */
  useEffect(() => {
    const onVoice = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.active) {
        setVoiceActive(true);
        pulseRef.current = 1.0;
      } else {
        setVoiceActive(false);
      }
    };
    window.addEventListener("litt-voice", onVoice);
    return () => window.removeEventListener("litt-voice", onVoice);
  }, []);

  /* Keep activeRef in sync with both prop and voice state */
  useEffect(() => {
    activeRef.current = active || voiceActive;
  }, [active, voiceActive]);

  /* Expose pulse method via ref for parent components — currently unused
   * but kept for future programmatic triggering. */
  // const pulse = useCallback(() => {
  //   pulseRef.current = 1.0;
  // }, []);

  /* Global event listeners */
  useEffect(() => {
    if (!trackCursor && !trackKeyboard) return;

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      mouseRef.current.hasMouse = true;
    };
    const onKeydown = () => {
      if (trackKeyboard)
        pulseRef.current = Math.min(1.0, pulseRef.current + 0.3);
    };

    if (trackCursor) {
      window.addEventListener("mousemove", onMouseMove);
    }
    if (trackKeyboard) {
      window.addEventListener("keydown", onKeydown);
    }
    return () => {
      if (trackCursor) window.removeEventListener("mousemove", onMouseMove);
      if (trackKeyboard) window.removeEventListener("keydown", onKeydown);
    };
  }, [trackCursor, trackKeyboard]);

  /* Main render loop */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const maxRadius = size / 2 - 4;

    // Particle system
    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      maxLife: number;
      size: number;
    }> = [];

    const spawnParticle = (intensity: number) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.3 + Math.random() * 1.5 * intensity;
      const dist = maxRadius * 0.3 + Math.random() * maxRadius * 0.4;
      particles.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 40 + Math.random() * 60,
        size: 0.5 + Math.random() * 2,
      });
    };

    const draw = () => {
      timeRef.current += 0.016;
      const t = timeRef.current;
      const isActive = activeRef.current;
      const pulse = pulseRef.current;

      // Decay pulse
      pulseRef.current = Math.max(0, pulseRef.current - 0.02);

      // Activity level combines active state and pulse
      const activity = isActive ? 0.6 + Math.sin(t * 4) * 0.15 : 0.15;
      const totalEnergy = activity + pulse * 0.5;

      // Clear with slight trail for motion blur
      ctx.fillStyle = `rgba(10, 10, 20, ${isActive ? 0.15 : 0.25})`;
      ctx.fillRect(0, 0, size, size);

      // Cursor parallax offset
      let parallaxX = 0;
      let parallaxY = 0;
      if (mouseRef.current.hasMouse) {
        const rect = canvas.getBoundingClientRect();
        const dx = mouseRef.current.x - (rect.left + cx);
        const dy = mouseRef.current.y - (rect.top + cy);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxOffset = 12;
        if (dist > 0) {
          parallaxX = (dx / dist) * Math.min(maxOffset, dist / 30);
          parallaxY = (dy / dist) * Math.min(maxOffset, dist / 30);
        }
      }

      // ---- Outer ring (rotating) ----
      const outerRadius = maxRadius * 0.92;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.15);
      ctx.strokeStyle = `${tokens.primary}${isActive ? "60" : "30"}`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, outerRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Tick marks on outer ring
      const tickCount = 48;
      for (let i = 0; i < tickCount; i++) {
        const angle = (i / tickCount) * Math.PI * 2;
        const tickLen = i % 4 === 0 ? 6 : 3;
        const r1 = outerRadius;
        const r2 = outerRadius - tickLen;
        ctx.strokeStyle = `${tokens.primary}${i % 4 === 0 ? "80" : "30"}`;
        ctx.lineWidth = i % 4 === 0 ? 1.5 : 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
        ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
        ctx.stroke();
      }
      ctx.restore();

      // ---- Middle ring (counter-rotating, with energy arcs) ----
      const midRadius = maxRadius * 0.72;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * 0.25);
      ctx.strokeStyle = `${tokens.secondary}40`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, midRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Energy arcs
      const arcCount = 4;
      for (let i = 0; i < arcCount; i++) {
        const startAngle = (i / arcCount) * Math.PI * 2 + t * 0.5;
        const arcLen = 0.3 + Math.sin(t * 2 + i) * 0.15 + pulse * 0.3;
        ctx.strokeStyle = `${tokens.secondary}${isActive ? "c0" : "60"}`;
        ctx.lineWidth = 2 + pulse * 2;
        ctx.shadowBlur = 8 + totalEnergy * 12;
        ctx.shadowColor = tokens.secondary;
        ctx.beginPath();
        ctx.arc(0, 0, midRadius, startAngle, startAngle + arcLen);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.restore();

      // ---- Inner core sphere ----
      const coreRadius = maxRadius * 0.35;
      const corePulse =
        1 +
        Math.sin(t * (isActive ? 6 : 2)) * (isActive ? 0.12 : 0.05) +
        pulse * 0.2;
      const coreX = cx + parallaxX * 0.5;
      const coreY = cy + parallaxY * 0.5;

      // Glow layers (back to front)
      const glowLayers = 5;
      for (let i = glowLayers; i > 0; i--) {
        const layerR = coreRadius * corePulse * (1 + i * 0.4);
        const alpha =
          (isActive ? 0.12 : 0.06) * (1 - i / glowLayers) + pulse * 0.05;
        const grad = ctx.createRadialGradient(
          coreX,
          coreY,
          0,
          coreX,
          coreY,
          layerR,
        );
        grad.addColorStop(
          0,
          `${tokens.primary}${Math.round(alpha * 255)
            .toString(16)
            .padStart(2, "0")}`,
        );
        grad.addColorStop(
          0.5,
          `${tokens.secondary}${Math.round(alpha * 0.5 * 255)
            .toString(16)
            .padStart(2, "0")}`,
        );
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(coreX, coreY, layerR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Core sphere itself
      const coreGrad = ctx.createRadialGradient(
        coreX - coreRadius * 0.3,
        coreY - coreRadius * 0.3,
        0,
        coreX,
        coreY,
        coreRadius * corePulse,
      );
      coreGrad.addColorStop(0, `${tokens.primary}ff`);
      coreGrad.addColorStop(0.4, `${tokens.primary}cc`);
      coreGrad.addColorStop(0.7, `${tokens.secondary}60`);
      coreGrad.addColorStop(1, `${tokens.primary}10`);
      ctx.fillStyle = coreGrad;
      ctx.shadowBlur = 20 + totalEnergy * 30;
      ctx.shadowColor = tokens.primary;
      ctx.beginPath();
      ctx.arc(coreX, coreY, coreRadius * corePulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Inner highlight (specular)
      ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + totalEnergy * 0.2})`;
      ctx.beginPath();
      ctx.arc(
        coreX - coreRadius * 0.25,
        coreY - coreRadius * 0.25,
        coreRadius * 0.15 * corePulse,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      // ---- Energy beams from core to outer ring (when active) ----
      if (isActive || pulse > 0.1) {
        const beamCount = 6;
        for (let i = 0; i < beamCount; i++) {
          const angle = (i / beamCount) * Math.PI * 2 + t * 0.8;
          const r1 = coreRadius * corePulse;
          const r2 = midRadius;
          const beamAlpha = (0.15 + pulse * 0.3) * (isActive ? 1 : pulse);
          ctx.strokeStyle = `${tokens.primary}${Math.round(beamAlpha * 255)
            .toString(16)
            .padStart(2, "0")}`;
          ctx.lineWidth = 1 + pulse;
          ctx.beginPath();
          ctx.moveTo(
            coreX + Math.cos(angle) * r1,
            coreY + Math.sin(angle) * r1,
          );
          ctx.lineTo(
            coreX + Math.cos(angle) * r2,
            coreY + Math.sin(angle) * r2,
          );
          ctx.stroke();
        }
      }

      // ---- Particles ----
      // Spawn particles based on activity
      const spawnRate = isActive ? 3 : pulse > 0.1 ? 2 : 0;
      for (let i = 0; i < spawnRate; i++) spawnParticle(totalEnergy);

      // Update and draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1 / p.maxLife;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        const alpha = p.life * 0.6;
        ctx.fillStyle = `${tokens.primary}${Math.round(alpha * 255)
          .toString(16)
          .padStart(2, "0")}`;
        ctx.shadowBlur = 4;
        ctx.shadowColor = tokens.primary;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // ---- Scan lines ----
      ctx.fillStyle = `rgba(255, 255, 255, 0.03)`;
      for (let y = 0; y < size; y += 3) {
        ctx.fillRect(0, y, size, 1);
      }

      // Moving scan line
      const scanY = ((t * 60) % (size + 40)) - 20;
      const scanGrad = ctx.createLinearGradient(0, scanY - 20, 0, scanY + 20);
      scanGrad.addColorStop(0, "transparent");
      scanGrad.addColorStop(0.5, `${tokens.primary}20`);
      scanGrad.addColorStop(1, "transparent");
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 20, size, 40);

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [size, tokens, trackCursor, trackKeyboard]);

  return (
    <div
      className="relative flex flex-col items-center justify-center"
      style={{ width: size, height: size + (label ? 24 : 0) }}
    >
      <canvas
        ref={canvasRef}
        className="rounded-full"
        style={{ display: "block" }}
      />
      {label && (
        <div
          className="mt-1 text-[10px] font-black uppercase tracking-[0.3em] transition-colors"
          style={{
            color: voiceActive || active ? tokens.primary : tokens.textMuted,
          }}
        >
          {voiceActive || active ? "● Listening" : label}
        </div>
      )}
    </div>
  );
}
