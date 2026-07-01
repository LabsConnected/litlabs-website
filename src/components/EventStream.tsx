"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Clock, AlertCircle, CheckCircle, ShoppingCart, UserPlus, MessageSquare, Zap, Database } from "lucide-react";

export interface Event {
  id: string;
  type: "user" | "agent" | "system" | "sale" | "alert" | "database" | "request";
  message: string;
  timestamp: Date;
  icon?: React.ReactNode;
  data?: Record<string, unknown>;
}

interface EventStreamProps {
  events?: Event[];
  maxEvents?: number;
}

export default function EventStream({ events: externalEvents, maxEvents = 10 }: EventStreamProps) {
  const { resolvedColors: T } = useTheme();
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    if (externalEvents) {
      setEvents(externalEvents);
      return;
    }

    // Mock events - replace with real WebSocket connection
    const mockEvents: Event[] = [
      { id: "1", type: "user", message: "User @alex joined the platform", timestamp: new Date(Date.now() - 1000 * 60 * 2), icon: <UserPlus size={12} /> },
      { id: "2", type: "agent", message: "JARVIS completed orchestration task", timestamp: new Date(Date.now() - 1000 * 60 * 5), icon: <CheckCircle size={12} /> },
      { id: "3", type: "system", message: "System health check passed", timestamp: new Date(Date.now() - 1000 * 60 * 10), icon: <Clock size={12} /> },
      { id: "4", type: "sale", message: "Agent sale: Code Champion purchased", timestamp: new Date(Date.now() - 1000 * 60 * 15), icon: <ShoppingCart size={12} /> },
      { id: "5", type: "agent", message: "Forge deployed production build", timestamp: new Date(Date.now() - 1000 * 60 * 20), icon: <CheckCircle size={12} /> },
      { id: "6", type: "user", message: "User @sarah created new project", timestamp: new Date(Date.now() - 1000 * 60 * 25), icon: <UserPlus size={12} /> },
      { id: "7", type: "alert", message: "High memory usage detected on Forge", timestamp: new Date(Date.now() - 1000 * 60 * 30), icon: <AlertCircle size={12} /> },
    ];

    setEvents(mockEvents);

    // Add new event every 30 seconds
    const interval = setInterval(() => {
      const eventTypes: Event["type"][] = ["user", "agent", "system", "sale", "alert", "database", "request"];
      const messages = [
        "User joined",
        "Agent task completed",
        "System check",
        "Sale made",
        "Alert triggered",
        "Database query",
        "API request",
      ];
      const newEvent: Event = {
        id: Date.now().toString(),
        type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
        message: messages[Math.floor(Math.random() * messages.length)],
        timestamp: new Date(),
      };
      setEvents(prev => [newEvent, ...prev].slice(0, maxEvents));
    }, 30000);

    return () => clearInterval(interval);
  }, [externalEvents, maxEvents]);

  const getEventColor = (type: Event["type"]) => {
    switch (type) {
      case "user": return "#3b82f6";
      case "agent": return "#22c55e";
      case "system": return "#8b5cf6";
      case "sale": return "#f59e0b";
      case "alert": return "#ef4444";
      case "database": return "#10b981";
      case "request": return "#06b6d4";
      default: return "#6b7280";
    }
  };

  const getEventIcon = (type: Event["type"]) => {
    switch (type) {
      case "user": return <UserPlus size={12} />;
      case "agent": return <CheckCircle size={12} />;
      case "system": return <Clock size={12} />;
      case "sale": return <ShoppingCart size={12} />;
      case "alert": return <AlertCircle size={12} />;
      case "database": return <Database size={12} />;
      case "request": return <Zap size={12} />;
      default: return <MessageSquare size={12} />;
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000 / 60);
    if (diff < 1) return "Just now";
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ago`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Clock size={14} style={{ color: T.accentColor }} />
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
          Live Events
        </span>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {events.length === 0 ? (
          <div className="text-center py-8">
            <Clock size={24} className="mx-auto mb-2" style={{ color: T.textMuted }} />
            <p className="text-xs" style={{ color: T.textMuted }}>No events yet</p>
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 p-3 rounded-xl border transition-all hover:scale-[1.01]"
              style={{
                backgroundColor: T.boxBg + "30",
                borderColor: T.borderColor + "20",
              }}
            >
              <div
                className="p-1.5 rounded-lg"
                style={{ backgroundColor: getEventColor(event.type) + "20", color: getEventColor(event.type) }}
              >
                {event.icon || getEventIcon(event.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs" style={{ color: T.textColor }}>{event.message}</p>
                <div className="text-[10px] mt-1" style={{ color: T.textMuted }}>{formatTime(event.timestamp)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
