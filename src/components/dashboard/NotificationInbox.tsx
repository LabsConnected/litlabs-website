"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  AlertTriangle,
  ShoppingBag,
  UserPlus,
  Bot,
  Zap,
  MessageSquare,
  X,
} from "lucide-react";

interface Notification {
  id: string;
  type: string;
  priority: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channels: string[];
  read: boolean;
  created_at: string;
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  sale: ShoppingBag,
  signup: UserPlus,
  agent_created: Bot,
  system_alert: AlertTriangle,
  chat: MessageSquare,
  marketing: Zap,
  cli_event: Zap,
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#00ff9d",
  medium: "#ffff00",
  high: "#ffa500",
  critical: "#ff0055",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationInbox() {
  const { resolvedColors: T } = useTheme();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/jarvis/notifications?limit=30");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // Silently handle fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    // Poll every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const markAllRead = async () => {
    try {
      await fetch("/api/jarvis/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Silently handle
    }
  };

  const markRead = async (ids: string[]) => {
    try {
      await fetch("/api/jarvis/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      setNotifications((prev) =>
        prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - ids.length));
    } catch {
      // Silently handle
    }
  };

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg transition-all hover:bg-white/5"
        style={{ color: unreadCount > 0 ? "#ff0055" : T.textMuted }}
        title={`${unreadCount} unread notifications`}
      >
        {unreadCount > 0 ? <Bell size={18} /> : <BellOff size={18} />}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#ff0055] text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Inbox panel */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-h-[420px] rounded-lg border overflow-hidden shadow-2xl z-50 flex flex-col"
          style={{
            backgroundColor: "rgba(10, 15, 20, 0.97)",
            borderColor: `${T.accentColor}30`,
            backdropFilter: "blur(16px)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
            <span className="text-xs font-mono uppercase tracking-wider text-white/60">
              Notifications
            </span>
            <div className="flex items-center gap-1.5">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10px] font-mono text-[#00ff9d]/70 hover:text-[#00ff9d] transition-colors px-1.5 py-0.5 rounded hover:bg-[#00ff9d]/5"
                  title="Mark all as read"
                >
                  <CheckCheck size={12} />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/30 hover:text-white/60 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto">
            {loading && notifications.length === 0 && (
              <div className="p-4 text-center text-xs text-white/30 font-mono">
                Loading...
              </div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="p-6 text-center text-xs text-white/30 font-mono">
                No notifications yet
              </div>
            )}
            {notifications.map((notif) => {
              const Icon = TYPE_ICONS[notif.type] || Bell;
              const priorityColor =
                PRIORITY_COLORS[notif.priority] || PRIORITY_COLORS.low;
              return (
                <div
                  key={notif.id}
                  onClick={() => {
                    if (!notif.read) markRead([notif.id]);
                  }}
                  className={`px-3 py-2.5 border-b border-white/5 cursor-pointer transition-colors hover:bg-white/5 ${!notif.read ? "bg-white/[0.02]" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="mt-0.5 p-1 rounded"
                      style={{
                        backgroundColor: `${priorityColor}15`,
                        color: priorityColor,
                      }}
                    >
                      <Icon size={12} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs font-semibold truncate ${!notif.read ? "text-white" : "text-white/60"}`}
                        >
                          {notif.title}
                        </span>
                        {!notif.read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00ff9d] shrink-0" />
                        )}
                      </div>
                      <p className="text-[10px] text-white/40 mt-0.5 line-clamp-2">
                        {notif.body}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-white/20 font-mono">
                          {timeAgo(notif.created_at)}
                        </span>
                        <span
                          className="text-[9px] font-mono uppercase px-1 rounded"
                          style={{
                            color: priorityColor,
                            backgroundColor: `${priorityColor}10`,
                          }}
                        >
                          {notif.priority}
                        </span>
                        {notif.read && (
                          <Check size={10} className="text-white/20" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
