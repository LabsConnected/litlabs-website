"use client";

import { useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ShoppingCart,
  UserPlus,
  Users,
} from "lucide-react";

export type AdminEvent = {
  id: string;
  type: "user" | "agent" | "system" | "sale" | "alert" | "signup" | "chat";
  message: string;
  timestamp: string | Date;
  data?: Record<string, unknown>;
};

const DEFAULT_EVENTS: AdminEvent[] = [
  {
    id: "1",
    type: "signup",
    message: "New user joined the platform",
    timestamp: new Date(Date.now() - 1000 * 60 * 2),
  },
  {
    id: "2",
    type: "agent",
    message: "LiTT completed a command cycle",
    timestamp: new Date(Date.now() - 1000 * 60 * 4),
  },
  {
    id: "3",
    type: "sale",
    message: "Code Champion purchased",
    timestamp: new Date(Date.now() - 1000 * 60 * 7),
  },
  {
    id: "4",
    type: "system",
    message: "Provider health check passed",
    timestamp: new Date(Date.now() - 1000 * 60 * 10),
  },
];

export default function EventStream({
  events = DEFAULT_EVENTS,
  onClear,
}: {
  events?: AdminEvent[];
  onClear?: () => void;
}) {
  const { resolvedColors: T } = useTheme();
  const rows = useMemo(() => events.slice(0, 12), [events]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={14} style={{ color: T.accentColor }} />
          <div
            className="text-xs font-bold uppercase tracking-[0.2em]"
            style={{ color: T.textMuted }}
          >
            Live Events
          </div>
        </div>
        {onClear && (
          <button
            onClick={onClear}
            className="rounded-full border px-3 py-1 text-[10px] font-black uppercase"
            style={{
              borderColor: T.borderColor + "30",
              color: T.textMuted,
              backgroundColor: T.boxBg + "60",
            }}
          >
            Clear
          </button>
        )}
      </div>
      <div className="space-y-2 max-h-[28rem] overflow-auto pr-1">
        {rows.length === 0 ? (
          <div
            className="rounded-2xl border px-4 py-6 text-center text-sm"
            style={{
              backgroundColor: T.boxBg + "60",
              borderColor: T.borderColor + "28",
              color: T.textMuted,
            }}
          >
            No recent activity
          </div>
        ) : (
          rows.map((event) => <EventRow key={event.id} event={event} />)
        )}
      </div>
    </div>
  );
}

const EVENT_ICONS: Record<AdminEvent["type"], typeof AlertCircle> = {
  signup: UserPlus,
  user: UserPlus,
  sale: ShoppingCart,
  agent: CheckCircle2,
  chat: CheckCircle2,
  alert: AlertCircle,
  system: Users,
};

function EventRow({ event }: { event: AdminEvent }) {
  const { resolvedColors: T } = useTheme();
  const color = getEventColor(event.type, T.accentColor);
  const Icon = EVENT_ICONS[event.type] ?? Users;

  return (
    <div
      className="flex items-start gap-3 rounded-2xl border p-3 transition-transform hover:scale-[1.01]"
      style={{ backgroundColor: T.boxBg + "60", borderColor: color + "26" }}
    >
      <div
        className="rounded-xl p-2"
        style={{ backgroundColor: color + "18", color }}
      >
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm" style={{ color: T.textColor }}>
          {event.message}
        </div>
        <div className="mt-1 text-[10px]" style={{ color: T.textMuted }}>
          {formatTime(event.timestamp)}
        </div>
      </div>
    </div>
  );
}

function formatTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const diff = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diff < 1) return "Just now";
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ago`;
}

function getEventColor(type: AdminEvent["type"], fallback: string) {
  switch (type) {
    case "signup":
    case "user":
      return "#60a5fa";
    case "agent":
    case "chat":
      return "#34d399";
    case "sale":
      return "#f59e0b";
    case "alert":
      return "#ef4444";
    case "system":
      return fallback;
    default:
      return fallback;
  }
}
