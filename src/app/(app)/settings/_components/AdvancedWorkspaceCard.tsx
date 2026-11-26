"use client";

/**
 * AdvancedWorkspaceCard — the Board's opt-in home (Larry's Board
 * demotion, 2026-11-22; looks approval 2026-11-25).
 *
 * Regular is Studio's default layout for everyone. The Board — every
 * surface as a free, movable panel — is an advanced workspace the
 * user turns on here, in Settings, with a short preview of what it
 * looks like. It is deliberately NOT an equal switch on the Studio
 * header or home screen. Turning it on writes the same persisted
 * layout choice the Board Settings menu writes (useStudioLayoutMode),
 * so a user who enabled the Board keeps it across sessions, and
 * turning it off returns them to Regular.
 */

import { LayoutGrid } from "lucide-react";
import { SettingsCard, ToggleRow } from "@/components/settings/SettingsPrimitives";
import { useTheme } from "@/context/ThemeContext";
import { useStudioLayoutMode } from "@/app/(app)/studio/stores/useStudioLayoutMode";

/** Miniature Regular layout: chat left, workspace centre, clear right. */
function RegularPreview() {
  const { tokens } = useTheme();
  return (
    <div
      className="flex h-20 gap-1 rounded-lg border p-1.5"
      style={{ borderColor: tokens.border, backgroundColor: `${tokens.text}06` }}
      aria-hidden
    >
      <div
        className="flex w-1/4 items-start rounded-md p-1 text-[8px] font-bold"
        style={{ backgroundColor: `${tokens.text}0D`, color: tokens.textMuted }}
      >
        Chat
      </div>
      <div
        className="flex flex-1 items-start rounded-md p-1 text-[8px] font-bold"
        style={{ backgroundColor: `${tokens.text}0D`, color: tokens.textMuted }}
      >
        Code · Preview
      </div>
      <div
        className="flex w-1/6 items-start rounded-md p-1 text-[8px] font-bold"
        style={{ backgroundColor: `${tokens.text}0D`, color: tokens.textMuted }}
      >
        Pop-ups
      </div>
    </div>
  );
}

/** Miniature Board layout: the same surfaces as free-floating panels. */
function BoardPreview() {
  const { tokens } = useTheme();
  return (
    <div
      className="relative h-20 rounded-lg border p-1.5"
      style={{ borderColor: tokens.border, backgroundColor: `${tokens.text}06` }}
      aria-hidden
    >
      <div
        className="absolute left-2 top-2 rounded-md p-1 text-[8px] font-bold"
        style={{ backgroundColor: `${tokens.text}0D`, color: tokens.textMuted }}
      >
        Chat
      </div>
      <div
        className="absolute right-2 top-2 rounded-md p-1 text-[8px] font-bold"
        style={{ backgroundColor: `${tokens.text}0D`, color: tokens.textMuted }}
      >
        Preview
      </div>
      <div
        className="absolute bottom-2 left-8 rounded-md p-1 text-[8px] font-bold"
        style={{ backgroundColor: `${tokens.text}0D`, color: tokens.textMuted }}
      >
        Code
      </div>
      <div
        className="absolute bottom-2 right-8 rounded-md p-1 text-[8px] font-bold"
        style={{ backgroundColor: `${tokens.text}0D`, color: tokens.textMuted }}
      >
        Terminal
      </div>
    </div>
  );
}

export function AdvancedWorkspaceCard() {
  const { layoutMode, setLayoutMode } = useStudioLayoutMode();
  const boardEnabled = layoutMode === "board";

  return (
    <SettingsCard
      title="Advanced workspace"
      description="The Board layout — every Studio surface as a movable panel"
      icon={<LayoutGrid size={16} />}
    >
      <div className="space-y-3" data-testid="advanced-workspace-card">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">
              Regular — the standard layout
            </p>
            <RegularPreview />
          </div>
          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">
              Board — the advanced workspace
            </p>
            <BoardPreview />
          </div>
        </div>
        <p className="text-[11px] leading-5 text-zinc-600">
          Regular keeps chat beside your work, with tools opening as pop-ups when you
          ask for them. The Board spreads every surface out as its own panel that you
          can drag, resize, and arrange however you like. Your projects, chats, and
          files are the same in both — only the arrangement changes.
        </p>
        <ToggleRow
          title="Enable advanced workspace"
          description={
            boardEnabled
              ? "The Board is on. Studio opens in the Board layout."
              : "Off — Studio opens in the Regular layout."
          }
          checked={boardEnabled}
          onChange={(on) => setLayoutMode(on ? "board" : "classic")}
        />
      </div>
    </SettingsCard>
  );
}
