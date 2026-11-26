"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useVisualViewport } from "../../hooks/useVisualViewport";

export interface MobileBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
}

/**
 * MobileBottomSheet — the mobile pop-out primitive for Studio
 * (Larry's mobile pop-out ruling, 2026-11-25).
 *
 * Used by the Build status sheet and the Tools sheet. Tools on
 * mobile are SMALL POP-OUT windows floating above chat — not
 * full-screen takeover sheets. Two stages, one rule with desktop:
 *
 *   Stage one (default): a floating card with margins on every
 *   side, capped at 58dvh, so chat stays visible around it and the
 *   user is never thrown into a big surface uninvited.
 *   Stage two: the header's expand control grows the card to the
 *   near-full sheet (92dvh) — only on the user's tap. The same
 *   control shrinks it back.
 *
 * Sits above the full-screen chat sheet (z-[10021]) and its
 * backdrop (z-[10020]).
 */
export default function MobileBottomSheet({
  open,
  onClose,
  title,
  children,
  testId,
}: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const vv = useVisualViewport();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement;
    sheetRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const previous = previousFocusRef.current;
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus();
      }
      previousFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[10022] bg-black/30"
        onClick={onClose}
        aria-label={`Close ${title}`}
        tabIndex={-1}
        aria-hidden
      />
      <div
        ref={sheetRef}
        className={
          expanded
            ? "fixed inset-x-0 bottom-0 z-[10023] flex max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl border-t shadow-2xl transition-all duration-200 ease-out"
            : "fixed inset-x-3 bottom-3 z-[10023] flex max-h-[58dvh] flex-col overflow-hidden rounded-2xl border shadow-2xl transition-all duration-200 ease-out"
        }
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId ?? "mobile-bottom-sheet"}
        data-stage={expanded ? "expanded" : "popout"}
        tabIndex={-1}
        style={{
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border-strong)",
          bottom: vv.bottomInset > 0 ? `${vv.bottomInset}px` : undefined,
        }}
      >
        <div className="flex items-center justify-between px-3 pt-2.5">
          <span
            style={{
              fontSize: 11,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: "var(--text-secondary)",
            }}
          >
            {title}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? `Shrink ${title}` : `Expand ${title}`}
              aria-expanded={expanded}
              data-testid="mobile-sheet-expand"
              className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </>
  );
}
