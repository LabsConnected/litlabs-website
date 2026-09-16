"use client";

import { createContext, useContext, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const DialogTitleIdContext = createContext<string | null>(null);

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogSize = "sm" | "md" | "lg";

const sizeClasses: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export interface DialogProps {
  /** Controls visibility. */
  open: boolean;
  /** Called on Escape, backdrop click (unless disabled), and close button. */
  onClose: () => void;
  /** Accessible name. Required when no DialogTitle is rendered. */
  ariaLabel?: string;
  size?: DialogSize;
  /** Disable backdrop-click dismissal (Escape still works). */
  disableBackdropClose?: boolean;
  /** Show the X close button. */
  showCloseButton?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Accessible modal dialog: focus trap, Escape to close, aria-modal,
 * returns focus to the previously focused element on close.
 * Replaces ad-hoc `window.prompt` / `window.confirm` usage.
 */
export function Dialog({
  open,
  onClose,
  ariaLabel,
  size = "md",
  disableBackdropClose = false,
  showCloseButton = true,
  children,
  className,
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) =>
          !el.closest("[hidden],[inert]") && el.getAttribute("aria-hidden") !== "true",
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    // Lock background scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the dialog.
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center p-4 sm:items-center"
      data-testid="litt-dialog-backdrop"
    >
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={() => {
          if (!disableBackdropClose) onClose();
        }}
        className="absolute inset-0 cursor-default bg-[#04050a]/72 backdrop-blur-sm motion-reduce:backdrop-blur-none"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        tabIndex={-1}
        className={cn(
          "relative w-full rounded-2xl border border-white/12 bg-[#10131b] p-5 sm:p-6",
          "shadow-[0_12px_40px_rgba(0,0,0,0.55)]",
          "focus-visible:outline-none",
          sizeClasses[size],
          className,
        )}
      >
        <DialogTitleIdContext.Provider value={ariaLabel ? null : titleId}>
        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-[44px] w-[44px] items-center justify-center rounded-xl text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(168,255,47,0.55)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        {children}
        </DialogTitleIdContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

export function DialogTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const titleId = useContext(DialogTitleIdContext);
  return (
    <h2
      id={titleId ?? undefined}
      className={cn("pr-10 text-xl font-semibold text-white", className)}
    >
      {children}
    </h2>
  );
}

export function DialogDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={cn("mt-1.5 text-sm text-white/60", className)}>{children}</p>;
}

export function DialogActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>
      {children}
    </div>
  );
}
