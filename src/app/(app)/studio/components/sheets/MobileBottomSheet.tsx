"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useVisualViewport } from "../../hooks/useVisualViewport";

export interface MobileBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
}

/**
 * MobileBottomSheet — generic mobile bottom-sheet primitive for Studio.
 *
 * Used by the Build status sheet and the Tools sheet. Sits above the
 * full-screen chat sheet (z-[10021]) and its backdrop (z-[10020]).
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
        className="fixed inset-0 z-[10022] bg-black/55"
        onClick={onClose}
        aria-label={`Close ${title}`}
        tabIndex={-1}
        aria-hidden
      />
      <div
        ref={sheetRef}
        className="fixed inset-x-0 bottom-0 z-[10023] flex max-h-[80dvh] flex-col overflow-hidden rounded-t-2xl border-t"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId ?? "mobile-bottom-sheet"}
        tabIndex={-1}
        style={{
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border-strong)",
          bottom: vv.bottomInset > 0 ? `${vv.bottomInset}px` : undefined,
        }}
      >
        <div
          className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20 md:hidden"
          aria-hidden
        />
        <div className="flex items-center justify-between px-3 pt-2">
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
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </>
  );
}
