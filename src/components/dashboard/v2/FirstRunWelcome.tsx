"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight, X } from "lucide-react";
import { D } from "@/lib/dashboard/tokens";

/**
 * FirstRunWelcome — a dismissible welcome banner shown on the dashboard
 * for brand-new users who have no projects, no missions, and no activity.
 *
 * Detection logic (any one triggers the banner):
 *   1. localStorage "litlabs-new-user" === "1" (set by UserSync when
 *      /api/account reports isNew=true)
 *   2. The mission-control response has no project, no missions, and no
 *      activity — a strong signal of a fresh account.
 *
 * The banner shows a single, clear primary CTA: "Open Studio & try LiTT".
 * It can be dismissed, which sets localStorage "litlabs-firstrun-dismissed"
 * to "1" so it never shows again for this browser.
 *
 * No tour, no multi-step wizard — just one obvious next action.
 */

const NEW_USER_KEY = "litlabs-new-user";
const DISMISSED_KEY = "litlabs-firstrun-dismissed";

export interface FirstRunWelcomeProps {
  /** When true, the mission-control data confirms no project, missions, or activity. */
  isEmptyAccount: boolean;
}

export function FirstRunWelcome({ isEmptyAccount }: FirstRunWelcomeProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
      if (dismissed) return;

      const isNewFlag = localStorage.getItem(NEW_USER_KEY) === "1";
      // Show if either the new-user flag is set OR the account is empty.
      // The empty-account check catches the case where UserSync hasn't
      // finished yet but the dashboard data already confirms a fresh state.
      if (isNewFlag || isEmptyAccount) {
        setVisible(true);
      }
    } catch {
      // localStorage not available — don't show
    }
  }, [isEmptyAccount]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="mb-5 overflow-hidden rounded-2xl border transition-all"
      style={{
        borderColor: `${D.accent}30`,
        background: `linear-gradient(135deg, ${D.accent}0a, ${D.surface} 60%)`,
        boxShadow: `0 4px 24px ${D.accent}10`,
      }}
      data-testid="firstrun-welcome"
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: `${D.accent}15`,
              border: `1px solid ${D.accent}30`,
            }}
          >
            <Sparkles size={18} style={{ color: D.accent }} />
          </div>
          <div className="min-w-0">
            <h2
              className="text-base font-black sm:text-lg"
              style={{ color: D.textPrimary }}
            >
              Welcome to LiTTree LabStudios
            </h2>
            <p
              className="mt-1 max-w-lg text-xs leading-relaxed sm:text-sm"
              style={{ color: D.textMuted }}
            >
              You&apos;re all set with 500 LiTTBits to start. Open Studio and ask
              LiTT to build something, fix code, or just explore.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/studio?tool=chat"
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black transition-all hover:scale-[1.02] active:scale-95"
            style={{
              background: D.accent,
              color: D.textOnAccent,
              boxShadow: `0 0 20px ${D.accent}40`,
            }}
            data-testid="firstrun-cta-studio"
          >
            Open Studio <ArrowRight size={15} />
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition hover:opacity-80"
            style={{
              borderColor: D.border,
              background: D.surface,
              color: D.textMuted,
            }}
            aria-label="Dismiss welcome"
            data-testid="firstrun-dismiss"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
