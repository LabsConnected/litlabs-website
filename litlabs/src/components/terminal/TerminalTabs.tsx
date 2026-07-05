"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { TerminalTab } from "./terminal-types";
import { TERMINAL_THEME } from "./terminal-theme";

const MAX_TABS = 8;

interface Props {
  tabs: TerminalTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
}

export function TerminalTabs({ tabs, activeTab, onTabChange, onAddTab, onCloseTab }: Props) {
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-center min-w-0 flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        className="flex items-center overflow-x-auto scrollbar-none min-w-0 flex-1"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const isHovered = hoveredTab === tab.id;

          return (
            <div
              key={tab.id}
              className="relative flex items-center gap-1.5 px-3 cursor-pointer select-none shrink-0 h-10 group"
              style={{
                backgroundColor: isActive
                  ? TERMINAL_THEME.toolbar.tabActiveBg
                  : isHovered
                  ? TERMINAL_THEME.toolbar.tabHoverBg
                  : "transparent",
                borderRight: `1px solid ${TERMINAL_THEME.ui.border}`,
                minWidth: "80px",
                maxWidth: "160px",
              }}
              onClick={() => onTabChange(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              {/* Active underline */}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ backgroundColor: TERMINAL_THEME.ui.accent }}
                />
              )}

              <span
                className="text-xs truncate flex-1"
                style={{
                  fontFamily: TERMINAL_THEME.font.family,
                  color: isActive
                    ? TERMINAL_THEME.toolbar.tabActiveText
                    : TERMINAL_THEME.toolbar.tabInactiveText,
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {tab.label}
              </span>

              {/* Close button — only visible on hover or active */}
              {(isHovered || isActive) && (
                <button
                  className="flex items-center justify-center w-4 h-4 rounded-sm shrink-0 transition-colors"
                  style={{ color: TERMINAL_THEME.ui.textMuted }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = TERMINAL_THEME.ui.error + "30";
                    e.currentTarget.style.color = TERMINAL_THEME.ui.error;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = TERMINAL_THEME.ui.textMuted;
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add tab button */}
      {tabs.length < MAX_TABS && (
        <button
          className="flex items-center justify-center w-8 h-8 rounded-sm mx-1 shrink-0 transition-colors"
          style={{ color: TERMINAL_THEME.ui.textMuted }}
          onClick={onAddTab}
          title="New tab"
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = TERMINAL_THEME.toolbar.tabHoverBg;
            e.currentTarget.style.color = TERMINAL_THEME.ui.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = TERMINAL_THEME.ui.textMuted;
          }}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
