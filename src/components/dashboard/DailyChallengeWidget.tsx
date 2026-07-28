"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  getDailyChallenge,
  getSurpriseChallenge,
  getChallengeUrl,
} from "@/lib/fun/selection";
import {
  THEME_PREVIEWS,
  getThemePreview,
  DEFAULT_THEME,
  type ThemeId,
} from "@/lib/fun/themes";
import type { CreativeChallenge } from "@/lib/fun/challenges";

/* ── Helpers ────────────────────────────────────────────────────── */

const DIFFICULTY_LABELS: Record<string, { label: string; color: string }> = {
  easy: { label: "Easy", color: "#B6FF4A" },
  medium: { label: "Medium", color: "#f97316" },
  wild: { label: "Wild", color: "#ff00a0" },
};

const TOOL_LABELS: Record<string, string> = {
  code: "Code Studio",
  image: "Image Studio",
  video: "Video Studio",
  audio: "Audio Studio",
};

const CATEGORY_LABELS: Record<string, string> = {
  "weird-build": "Weird Build",
  "impossible-product": "Impossible Product",
  "visual-remix": "Visual Remix",
  "fake-game": "Fake Game",
  "cinematic-scene": "Cinematic Scene",
  "design-rescue": "Design Rescue",
  "spark-wildcard": "Spark Wildcard",
};

/* ── Inline SVG icons (lucide-react is pinned to old version) ───── */

function IconSparkles({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
    </svg>
  );
}

function IconArrowRight({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function IconShuffle({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  );
}

function IconPalette({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.504 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

/* ── Theme Preview Card ─────────────────────────────────────────── */

function ThemePreviewCard({
  themeId,
  selected,
  onSelect,
}: {
  themeId: ThemeId;
  selected: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  const theme = getThemePreview(themeId);

  return (
    <button
      onClick={() => onSelect(themeId)}
      className="group relative overflow-hidden rounded-xl text-left transition-all hover:scale-[1.02]"
      style={{
        background: theme.background,
        border: selected
          ? `2px solid ${theme.primaryAccent}`
          : `1px solid ${theme.primaryAccent}30`,
        minHeight: 44,
      }}
      aria-pressed={selected}
      aria-label={`Preview theme: ${theme.name}`}
    >
      {/* Glow */}
      <div
        className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-30 pointer-events-none transition-opacity group-hover:opacity-50"
        style={{
          background: `radial-gradient(circle, ${theme.primaryAccent} 0%, transparent 65%)`,
          filter: `blur(${20 * theme.glowIntensity}px)`,
        }}
      />
      {/* Content */}
      <div className="relative p-3">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ background: theme.primaryAccent, boxShadow: `0 0 8px ${theme.primaryAccent}` }}
          />
          <div
            className="w-3 h-3 rounded-full"
            style={{ background: theme.secondaryAccent, boxShadow: `0 0 6px ${theme.secondaryAccent}` }}
          />
          <div
            className="w-3 h-3 rounded-full"
            style={{ background: theme.status, opacity: 0.7 }}
          />
        </div>
        <div className="text-xs font-black mb-0.5" style={{ color: theme.heading }}>
          {theme.name}
        </div>
        <div className="text-[10px] leading-tight" style={{ color: theme.bodyText, opacity: 0.7 }}>
          {theme.description}
        </div>
        {/* Button preview */}
        <div
          className="mt-2 inline-block px-2 py-1 rounded-md text-[9px] font-bold"
          style={{
            background: `${theme.primaryAccent}20`,
            color: theme.primaryAccent,
            border: `1px solid ${theme.primaryAccent}40`,
          }}
        >
          Button
        </div>
      </div>
      {selected && (
        <div
          className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
          style={{ background: theme.primaryAccent }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={theme.background} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
      )}
    </button>
  );
}

/* ── Main Daily Challenge Widget ───────────────────────────────── */

export function DailyChallengeWidget() {
  const router = useRouter();
  const dailyChallenge = useMemo(() => getDailyChallenge(), []);
  const [currentChallenge, setCurrentChallenge] = useState<CreativeChallenge>(dailyChallenge);
  const [isSurprise, setIsSurprise] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [showThemes, setShowThemes] = useState(false);
  const [spinning, setSpinning] = useState(false);

  const theme = getThemePreview(selectedTheme);
  const diffInfo = DIFFICULTY_LABELS[currentChallenge.difficulty];

  const handleStart = useCallback(() => {
    router.push(getChallengeUrl(currentChallenge));
  }, [router, currentChallenge]);

  const handleSurprise = useCallback(() => {
    setSpinning(true);
    // Brief animation for feedback
    setTimeout(() => {
      const surprise = getSurpriseChallenge();
      setCurrentChallenge(surprise);
      setIsSurprise(true);
      setSpinning(false);
    }, 400);
  }, []);

  const handleResetToDaily = useCallback(() => {
    setCurrentChallenge(dailyChallenge);
    setIsSurprise(false);
  }, [dailyChallenge]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 lg:p-6"
      style={{
        background: `linear-gradient(135deg, ${theme.primaryAccent}10 0%, ${theme.panel} 50%, ${theme.background} 100%)`,
        border: `1px solid ${theme.primaryAccent}25`,
      }}
    >
      {/* Background glow */}
      <div
        className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-15 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${theme.primaryAccent} 0%, transparent 65%)`,
          filter: `blur(${48 * theme.glowIntensity}px)`,
        }}
      />
      <div
        className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full opacity-10 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${theme.secondaryAccent} 0%, transparent 70%)`,
          filter: `blur(${40 * theme.glowIntensity}px)`,
        }}
      />

      <div className="relative">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <IconSparkles size={14} className="text-amber-400" />
          <span
            className="text-xs font-black uppercase tracking-[0.2em]"
            style={{ color: theme.primaryAccent }}
          >
            {isSurprise ? "Surprise Challenge" : "Today's LiTT Challenge"}
          </span>
        </div>

        {/* Title */}
        <h3
          className="text-xl lg:text-2xl font-black mb-2"
          style={{ color: theme.heading }}
        >
          {currentChallenge.title}
        </h3>

        {/* Objective */}
        <p
          className="text-sm font-medium mb-4 max-w-lg"
          style={{ color: theme.bodyText, opacity: 0.85 }}
        >
          {currentChallenge.objective}
        </p>

        {/* Meta tags */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold"
            style={{
              background: `${diffInfo.color}20`,
              color: diffInfo.color,
              border: `1px solid ${diffInfo.color}30`,
            }}
          >
            {diffInfo.label}
          </span>
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold"
            style={{
              background: `${theme.status}15`,
              color: theme.status,
              border: `1px solid ${theme.status}25`,
            }}
          >
            {TOOL_LABELS[currentChallenge.suggestedTool] ?? currentChallenge.suggestedTool}
          </span>
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold"
            style={{
              background: `${theme.secondaryAccent}15`,
              color: theme.secondaryAccent,
              border: `1px solid ${theme.secondaryAccent}25`,
            }}
          >
            {CATEGORY_LABELS[currentChallenge.category] ?? currentChallenge.category}
          </span>
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold"
            style={{
              background: `${getThemePreview(currentChallenge.visualTheme).primaryAccent}15`,
              color: getThemePreview(currentChallenge.visualTheme).primaryAccent,
              border: `1px solid ${getThemePreview(currentChallenge.visualTheme).primaryAccent}25`,
            }}
          >
            <IconPalette size={11} />
            {getThemePreview(currentChallenge.visualTheme).name}
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleStart}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:scale-[1.02]"
            style={{
              background: theme.primaryAccent,
              color: theme.background,
              minHeight: 44,
            }}
          >
            <IconArrowRight size={14} />
            Start Challenge
          </button>
          <button
            onClick={handleSurprise}
            disabled={spinning}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all hover:opacity-80 disabled:opacity-50"
            style={{
              background: `${theme.secondaryAccent}20`,
              color: theme.secondaryAccent,
              border: `1px solid ${theme.secondaryAccent}30`,
              minHeight: 44,
            }}
          >
            <IconShuffle size={14} className={spinning ? "animate-spin" : ""} />
            Surprise Me
          </button>
          {isSurprise && (
            <button
              onClick={handleResetToDaily}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all hover:opacity-80"
              style={{
                background: `${theme.bodyText}10`,
                color: theme.bodyText,
                border: `1px solid ${theme.bodyText}20`,
                minHeight: 44,
              }}
            >
              Back to Daily
            </button>
          )}
          <button
            onClick={() => setShowThemes((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all hover:opacity-80"
            style={{
              background: `${theme.bodyText}08`,
              color: theme.bodyText,
              border: `1px solid ${theme.bodyText}15`,
              minHeight: 44,
            }}
          >
            <IconPalette size={14} />
            {showThemes ? "Hide Themes" : "Theme Previews"}
          </button>
        </div>

        {/* Theme previews */}
        {showThemes && (
          <div className="mt-5 pt-5" style={{ borderTop: `1px solid ${theme.primaryAccent}15` }}>
            <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: theme.bodyText, opacity: 0.5 }}>
              Preview Preference <span className="normal-case font-normal opacity-60">(not an unlock)</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {THEME_PREVIEWS.map((t) => (
                <ThemePreviewCard
                  key={t.id}
                  themeId={t.id}
                  selected={selectedTheme === t.id}
                  onSelect={setSelectedTheme}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
