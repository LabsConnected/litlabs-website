"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { getWallpaperById } from "@/lib/wallpapers";

interface Orb {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  radius: number;
  vx: number;
  vy: number;
  hue: number;
  hueSpeed: number;
  pulse: number;
  pulseSpeed: number;
  orbitAngle: number;
  orbitRadius: number;
  orbitSpeed: number;
}

interface AuroraRibbon {
  points: { x: number; y: number; offset: number }[];
  amplitude: number;
  speed: number;
  hue: number;
  yBase: number;
}

interface Sparkle {
  x: number;
  y: number;
  size: number;
  alpha: number;
  targetAlpha: number;
  fadeSpeed: number;
  hue: number;
}

export type BackgroundMode =
  | "constellation"
  | "nebula"
  | "waves"
  | "minimal"
  | "holo";

const cssBackgrounds: Record<BackgroundMode, string> = {
  constellation:
    "radial-gradient(circle at 50% 50%, rgba(100,100,255,0.06), transparent 60%)",
  nebula:
    "radial-gradient(circle at 20% 30%, rgba(167,139,250,0.12), transparent 40%), radial-gradient(circle at 80% 70%, rgba(34,211,238,0.10), transparent 45%), radial-gradient(circle at 50% 50%, rgba(236,72,153,0.06), transparent 60%)",
  waves:
    "linear-gradient(135deg, rgba(34,211,238,0.06) 0%, transparent 50%, rgba(167,139,250,0.06) 100%)",
  minimal: "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.03), transparent 50%)",
  holo:
    "repeating-linear-gradient(45deg, rgba(34,211,238,0.04) 0px, transparent 2px, transparent 40px), repeating-linear-gradient(-45deg, rgba(236,72,153,0.04) 0px, transparent 2px, transparent 40px)",
};

export default function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme, resolvedColors } = useTheme();
  const { profile } = useProfile();
  const colorsRef = useRef(resolvedColors);
  const mode = theme.backgroundMode || "constellation";
  const wallpaper = getWallpaperById(profile.wallpaper);
  const customWallpaper = profile.wallpaper === "custom" && profile.customWallpaperUrl;
  const showWallpaper = profile.wallpaper !== "mesh" && (profile.wallpaper !== "custom" || customWallpaper);

  useEffect(() => {
    colorsRef.current = resolvedColors;
  }, [resolvedColors]);

  useEffect(() => {
    if (mode !== "constellation") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Respect reduced motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let animId: number;
    let w = 0,
      h = 0;
    let time = 0;
    let lastFrame = 0;
    const FRAME_INTERVAL = 1000 / 30; // throttle to 30fps
    const mouse = { x: -1000, y: -1000 };
    let visible = true;

    function onVisChange() {
      visible = !document.hidden;
    }
    document.addEventListener("visibilitychange", onVisChange);

    /* ── Helpers ── */
    function hexToRgb(hex: string) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return { r, g, b };
    }
    function rgbToHsl(r: number, g: number, b: number) {
      r /= 255;
      g /= 255;
      b /= 255;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      let h = 0,
        s = 0;
      const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r:
            h = (g - b) / d + (g < b ? 6 : 0);
            break;
          case g:
            h = (b - r) / d + 2;
            break;
          case b:
            h = (r - g) / d + 4;
            break;
        }
        h /= 6;
      }
      return { h: h * 360, s: s * 100, l: l * 100 };
    }
    function hslToRgb(h: number, s: number, l: number) {
      s /= 100;
      l /= 100;
      const k = (n: number) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) =>
        l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return {
        r: Math.round(f(0) * 255),
        g: Math.round(f(8) * 255),
        b: Math.round(f(4) * 255),
      };
    }

    /* ── Resize ── */
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.width = window.innerWidth * dpr;
      h = canvas!.height = window.innerHeight * dpr;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.scale(dpr, dpr);
      w = window.innerWidth;
      h = window.innerHeight;
    }

    /* ── Init Orbs ── */
    const orbs: Orb[] = [];
    function initOrbs() {
      orbs.length = 0;
      const count = 9;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const dist = 80 + Math.random() * 250;
        orbs.push({
          x: w / 2 + Math.cos(angle) * dist,
          y: h / 2 + Math.sin(angle) * dist,
          baseX: w / 2 + Math.cos(angle) * dist,
          baseY: h / 2 + Math.sin(angle) * dist,
          radius: 40 + Math.random() * 80,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15,
          hue: Math.random() * 360,
          hueSpeed: 0.1 + Math.random() * 0.3,
          pulse: Math.random() * Math.PI * 2,
          pulseSpeed: 0.005 + Math.random() * 0.01,
          orbitAngle: angle,
          orbitRadius: dist,
          orbitSpeed: (Math.random() - 0.5) * 0.0008,
        });
      }
    }

    /* ── Init Auroras ── */
    const auroras: AuroraRibbon[] = [];
    function initAuroras() {
      auroras.length = 0;
      for (let i = 0; i < 3; i++) {
        const pts = 12;
        const points = [];
        for (let p = 0; p <= pts; p++) {
          points.push({
            x: (p / pts) * w,
            y: 0,
            offset: Math.random() * Math.PI * 2,
          });
        }
        auroras.push({
          points,
          amplitude: 30 + Math.random() * 50,
          speed: 0.3 + Math.random() * 0.5,
          hue: i * 60,
          yBase: h * (0.25 + i * 0.25),
        });
      }
    }

    /* ── Init Sparkles ── */
    const sparkles: Sparkle[] = [];
    function initSparkles() {
      sparkles.length = 0;
      for (let i = 0; i < 15; i++) {
        sparkles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          size: 0.5 + Math.random() * 2,
          alpha: 0,
          targetAlpha: Math.random() * 0.6,
          fadeSpeed: 0.005 + Math.random() * 0.015,
          hue: Math.random() * 360,
        });
      }
    }

    /* ── Draw ── */
    function draw(now: number) {
      if (!visible) {
        animId = requestAnimationFrame(draw);
        return;
      }
      const elapsed = now - lastFrame;
      if (elapsed < FRAME_INTERVAL) {
        animId = requestAnimationFrame(draw);
        return;
      }
      lastFrame = now - (elapsed % FRAME_INTERVAL);

      const cols = colorsRef.current;
      const linkRgb = hexToRgb(cols.linkColor);
      const accentRgb = hexToRgb(cols.accentColor);
      const baseHsl = rgbToHsl(linkRgb.r, linkRgb.g, linkRgb.b);

      // Trail effect — don't fully clear
      ctx!.globalCompositeOperation = "source-over";
      ctx!.fillStyle = `rgba(10, 10, 15, 0.18)`;
      ctx!.fillRect(0, 0, w, h);

      time += 1;

      // Mouse spotlight (soft radial glow)
      if (mouse.x > -100) {
        const spot = ctx!.createRadialGradient(
          mouse.x,
          mouse.y,
          0,
          mouse.x,
          mouse.y,
          350,
        );
        spot.addColorStop(
          0,
          `rgba(${linkRgb.r},${linkRgb.g},${linkRgb.b},0.06)`,
        );
        spot.addColorStop(
          0.5,
          `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0.02)`,
        );
        spot.addColorStop(1, "transparent");
        ctx!.fillStyle = spot;
        ctx!.fillRect(0, 0, w, h);
      }

      // ── Auroras ──
      ctx!.globalCompositeOperation = "screen";
      for (const aurora of auroras) {
        const { h: ah, s, l } = baseHsl;
        const ribbonHue = (ah + aurora.hue + time * 0.05) % 360;
        const rgb = hslToRgb(ribbonHue, s * 0.8, l * 0.6);

        ctx!.beginPath();
        for (let i = 0; i < aurora.points.length; i++) {
          const pt = aurora.points[i];
          const wave =
            Math.sin(pt.offset + time * aurora.speed * 0.01) * aurora.amplitude;
          const y = aurora.yBase + wave + Math.sin(time * 0.003 + i) * 20;
          if (i === 0) ctx!.moveTo(pt.x, y);
          else ctx!.lineTo(pt.x, y);
        }
        ctx!.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`;
        ctx!.lineWidth = 60;
        ctx!.lineCap = "round";
        ctx!.stroke();

        ctx!.beginPath();
        for (let i = 0; i < aurora.points.length; i++) {
          const pt = aurora.points[i];
          const wave =
            Math.sin(pt.offset + time * aurora.speed * 0.01) * aurora.amplitude;
          const y = aurora.yBase + wave + Math.sin(time * 0.003 + i) * 20;
          if (i === 0) ctx!.moveTo(pt.x, y);
          else ctx!.lineTo(pt.x, y);
        }
        ctx!.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`;
        ctx!.lineWidth = 20;
        ctx!.stroke();
      }

      // ── Orbs ──
      ctx!.globalCompositeOperation = "screen";
      for (const orb of orbs) {
        // Orbit drift
        orb.orbitAngle += orb.orbitSpeed;
        orb.baseX = w / 2 + Math.cos(orb.orbitAngle) * orb.orbitRadius;
        orb.baseY = h / 2 + Math.sin(orb.orbitAngle) * orb.orbitRadius * 0.6;
        orb.x += orb.vx + Math.sin(time * 0.002 + orb.orbitAngle) * 0.1;
        orb.y += orb.vy + Math.cos(time * 0.003 + orb.orbitAngle) * 0.1;
        orb.pulse += orb.pulseSpeed;
        orb.hue = (baseHsl.h + orb.hue + time * orb.hueSpeed) % 360;

        const pulseScale = 1 + Math.sin(orb.pulse) * 0.2;
        const r = orb.radius * pulseScale;
        const rgb = hslToRgb(orb.hue, 70, 55);

        // Outer glow
        const grad = ctx!.createRadialGradient(
          orb.x,
          orb.y,
          0,
          orb.x,
          orb.y,
          r * 3,
        );
        grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.25)`);
        grad.addColorStop(0.4, `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`);
        grad.addColorStop(1, "transparent");
        ctx!.fillStyle = grad;
        ctx!.fillRect(orb.x - r * 3, orb.y - r * 3, r * 6, r * 6);

        // Core orb
        const core = ctx!.createRadialGradient(
          orb.x,
          orb.y,
          0,
          orb.x,
          orb.y,
          r,
        );
        core.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.5)`);
        core.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`);
        core.addColorStop(1, "transparent");
        ctx!.fillStyle = core;
        ctx!.beginPath();
        ctx!.arc(orb.x, orb.y, r, 0, Math.PI * 2);
        ctx!.fill();
      }

      // ── Sparkles ──
      ctx!.globalCompositeOperation = "screen";
      for (const s of sparkles) {
        s.alpha += (s.targetAlpha - s.alpha) * s.fadeSpeed;
        if (Math.abs(s.alpha - s.targetAlpha) < 0.01) {
          s.targetAlpha = s.targetAlpha > 0.1 ? 0 : Math.random() * 0.6;
        }
        const rgb = hslToRgb((baseHsl.h + s.hue) % 360, 60, 70);
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${s.alpha})`;
        ctx!.fill();
      }

      // ── Subtle grid overlay (fades at edges) ──
      ctx!.globalCompositeOperation = "source-over";
      const gridGrad = ctx!.createRadialGradient(
        w / 2,
        h / 2,
        0,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.7,
      );
      gridGrad.addColorStop(
        0,
        `rgba(${linkRgb.r},${linkRgb.g},${linkRgb.b},0.02)`,
      );
      gridGrad.addColorStop(1, "transparent");
      ctx!.fillStyle = gridGrad;
      ctx!.fillRect(0, 0, w, h);

      animId = requestAnimationFrame(draw);
    }

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }
    function onMouseLeave() {
      mouse.x = -1000;
      mouse.y = -1000;
    }
    function onResize() {
      resize();
      initOrbs();
      initAuroras();
      initSparkles();
    }

    resize();
    initOrbs();
    initAuroras();
    initSparkles();
    draw(performance.now());

    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);

    return () => {
      cancelAnimationFrame(animId);
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [mode]);

  return (
    <>
      {showWallpaper ? (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: 0,
            backgroundColor: resolvedColors.bgColor,
            ...(customWallpaper
              ? {
                  backgroundImage: `linear-gradient(rgba(3,7,18,.34), rgba(3,7,18,.58)), url(${profile.customWallpaperUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundAttachment: "fixed",
                }
              : wallpaper.fullStyle),
            transition: "background 0.5s ease",
          }}
        />
      ) : mode === "constellation" ? (
        <canvas
          ref={canvasRef}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 0,
            pointerEvents: "none",
            willChange: "transform",
          }}
        />
      ) : (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 0,
            pointerEvents: "none",
            background: cssBackgrounds[mode],
            backgroundColor: resolvedColors.bgColor,
            transition: "background 0.5s ease",
          }}
        />
      )}
    </>
  );
}
