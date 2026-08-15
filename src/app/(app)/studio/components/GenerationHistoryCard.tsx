"use client";

import { Trash2, X, Loader2, ImageIcon } from "lucide-react";
import type { CSSProperties } from "react";

/**
 * Props for a single generation entry rendered by GenerationHistoryCard.
 * Kept minimal so the card can be reused in both the canvas "Recent"
 * strip and the right-side History grid without coupling to the parent's
 * full Generation type.
 */
export interface GenerationCardData {
  id: string;
  prompt: string;
  fileUrl?: string;
  status: string;
  provider: string;
}

interface GenerationHistoryCardProps {
  generation: GenerationCardData;
  isSelected: boolean;
  onSelect: (generation: GenerationCardData) => void;
  onDelete: (generationId: string) => void;
  /** Theme tokens from the host component. */
  accentColor: string;
  borderColor: string;
  bgColor: string;
  textMuted: string;
  /** Optional: render with a fixed non-square aspect (e.g. horizontal strip). */
  className?: string;
  /** Optional: inline style overrides for the outer wrapper. */
  style?: CSSProperties;
  /** Test id hook for integration tests. */
  testId?: string;
}

/**
 * GenerationHistoryCard — a single reusable thumbnail tile.
 *
 * Renders a `<div>` wrapper containing:
 *   1. A `<button>` that selects the generation (no nested buttons — valid HTML)
 *   2. A separate delete `<button>` positioned absolutely on top
 *   3. A hover/focus gradient overlay showing the provider name
 *
 * The delete button is always visible on touch/mobile (no hover available)
 * and fades in on hover/focus for desktop.
 */
export default function GenerationHistoryCard({
  generation,
  isSelected,
  onSelect,
  onDelete,
  accentColor,
  borderColor,
  bgColor,
  textMuted,
  className = "aspect-square",
  style,
  testId,
}: GenerationHistoryCardProps) {
  return (
    <div
      className={`group relative ${className}`}
      style={style}
      data-testid={testId}
      data-generation-id={generation.id}
    >
      <button
        type="button"
        onClick={() => onSelect(generation)}
        className="h-full w-full overflow-hidden rounded-lg border transition hover:scale-[1.02]"
        style={{
          borderColor: isSelected ? accentColor : `${borderColor}40`,
          boxShadow: isSelected ? `0 0 8px ${accentColor}40` : "none",
        }}
        aria-label={`Open generation: ${generation.prompt}`}
      >
        {generation.fileUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={generation.fileUrl}
            alt={generation.prompt}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
            data-testid="generated-image"
          />
        ) : generation.status === "failed" ? (
          <div
            className="flex h-full w-full items-center justify-center bg-red-500/10 text-red-400"
            style={{ backgroundColor: `${bgColor}` }}
          >
            <X size={20} />
          </div>
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ backgroundColor: bgColor }}
          >
            {generation.status === "submitting" ||
            generation.status === "polling" ||
            generation.status === "forging" ? (
              <Loader2 size={14} className="animate-spin opacity-50" />
            ) : (
              <ImageIcon size={14} style={{ color: textMuted, opacity: 0.3 }} />
            )}
          </div>
        )}
      </button>

      {/* Delete button — separate from the select button (no nested buttons).
          Always visible on touch; hover-reveal on desktop. */}
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDelete(generation.id);
        }}
        className="
          absolute right-1.5 top-1.5
          grid h-7 w-7 place-items-center
          rounded-lg border border-red-400/30
          bg-black/80 text-red-300
          opacity-100 transition
          hover:bg-red-500 hover:text-white
          sm:opacity-0
          sm:group-hover:opacity-100
          sm:group-focus-within:opacity-100
        "
        aria-label="Delete generation"
        title="Delete this generation"
        data-testid="delete-generation"
      >
        <Trash2 size={13} />
      </button>

      {/* Provider label — hover/focus gradient overlay */}
      <div
        className="
          pointer-events-none absolute inset-x-0 bottom-0
          bg-gradient-to-t from-black/90 to-transparent
          px-2 pb-1.5 pt-6
          opacity-0 transition
          group-hover:opacity-100
          group-focus-within:opacity-100
        "
      >
        <p className="truncate text-[10px] text-white">{generation.provider}</p>
      </div>
    </div>
  );
}
