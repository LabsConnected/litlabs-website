"use client";

/**
 * GameCreatorEmptyState — the honest surface for the Create "game" mode.
 *
 * There is NO game creator in Studio: the taxonomy carries "game" as a
 * routing slot only (tests/creator-normalization.test.ts pins that no
 * GameCreatorTool exists). Before ART-20261111-035 the Create
 * destination's tool resolution fell through to the IMAGE studio for
 * this mode — picking Game silently opened a different creator.
 *
 * This surface says plainly that game creation isn't built yet and
 * routes the user's intent into the ONE chat (bare /studio renders the
 * main chat since the one-chat entry landed) — it carries no prompt or
 * chat input of its own, per the one-prompt rule.
 */

import { useRouter } from "next/navigation";
import { Gamepad2, MessagesSquare } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

export default function GameCreatorEmptyState() {
  const { tokens } = useTheme();
  const router = useRouter();

  return (
    <div
      data-testid="game-empty-state"
      className="flex w-full items-center justify-center p-6"
      style={{ backgroundColor: tokens.background, color: tokens.text, minHeight: "100%" }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 text-center"
        style={{ borderColor: tokens.border, background: tokens.surface }}
      >
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: tokens.primary + "26", border: `1px solid ${tokens.primary}4D` }}
        >
          <Gamepad2 size={22} style={{ color: tokens.primary }} />
        </div>
        <div className="mt-4 text-base font-black tracking-tight" style={{ color: tokens.text }}>
          Game creation isn&apos;t built yet
        </div>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: tokens.textMuted }}>
          There&apos;s no game creator in Studio yet — and no second prompt box waiting for
          you here. Describe the game you want in the LiTT chat and LiTT can plan it and
          build it with you as a web project.
        </p>
        <button
          onClick={() => router.replace("/studio")}
          className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black transition hover:scale-[1.02] active:scale-95"
          style={{
            background: tokens.primary,
            color: tokens.textInverse,
            boxShadow: `0 0 24px ${tokens.primary}4D`,
            minHeight: 40,
          }}
        >
          <MessagesSquare size={14} />
          Describe it in the chat
        </button>
      </div>
    </div>
  );
}
