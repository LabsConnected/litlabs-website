"use client";

import { useUser } from "@clerk/nextjs";
import {
  LayoutDashboard,
  Terminal,
  FolderOpen,
  Bot,
  Rocket,
  Key,
  CreditCard,
  LogOut,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard", active: false },
  { label: "Jarvis Terminal", icon: Terminal, href: "/jarvis-terminal", active: true },
  { label: "Files", icon: FolderOpen, href: "#", active: false },
  { label: "Agents", icon: Bot, href: "#", active: false },
  { label: "Deployments", icon: Rocket, href: "#", active: false },
  { label: "API Keys", icon: Key, href: "#", active: false },
  { label: "Billing", icon: CreditCard, href: "#", active: false },
];

export function LeftSidebar() {
  const { user, isLoaded } = useUser();

  return (
    <aside className="hidden flex-col border-r border-neutral-900 bg-[#0b0b0c] p-4 lg:flex">
      <div className="mb-8 text-orange-500 font-bold tracking-wide">
        LiTTree OS
      </div>

      <nav className="flex-1 space-y-1 text-sm">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.label}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 transition ${
                item.active
                  ? "bg-orange-600/20 text-orange-400"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-neutral-900 pt-4">
        {isLoaded && user ? (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 text-xs font-bold">
              {user.firstName?.[0] || user.username?.[0] || "U"}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-sm font-semibold">{user.fullName || user.username || "User"}</div>
              <div className="truncate text-xs text-neutral-500">{user.primaryEmailAddress?.emailAddress}</div>
            </div>
            <LogOut className="h-4 w-4 text-neutral-500" />
          </div>
        ) : (
          <div className="text-xs text-neutral-500">Loading user...</div>
        )}
      </div>
    </aside>
  );
}
