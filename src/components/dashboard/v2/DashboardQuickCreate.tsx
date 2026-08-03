"use client";

import { useTheme } from "@/context/ThemeContext";
import { Icon } from "./dashboard-v2-utils";

const QUICK_ACTIONS = [
  { label: "Open Studio", href: "/studio", icon: "play" },
  { label: "New Project", href: "/projects/new", icon: "plus" },
  { label: "Create Image", href: "/studio?tool=image", icon: "image" },
  { label: "Make Music", href: "/studio?tool=music", icon: "music" },
  { label: "Create Agent", href: "/studio?tool=agents", icon: "bot" },
  { label: "Start Mission", href: "/studio?tool=workflows", icon: "target" },
  { label: "Upload Project", href: "/studio/github", icon: "git" },
] as const;

export function DashboardQuickCreate() {
  const T = useTheme().resolvedColors;

  return (
    <div className="flex flex-wrap gap-2">
      {QUICK_ACTIONS.map((action) => (
        <a
          key={action.label}
          href={action.href}
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all hover:scale-[1.02]"
          style={{
            background: `${T.accentColor}12`,
            color: T.accentColor,
            border: `1px solid ${T.accentColor}25`,
            minHeight: 44,
          }}
        >
          <Icon name={action.icon} size={13} />
          {action.label}
        </a>
      ))}
    </div>
  );
}
