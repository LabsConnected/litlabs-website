"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Terminal,
  FolderOpen,
  Bot,
  Rocket,
  Key,
  CreditCard,
  LogOut,
  Store,
  BookOpen,
  Settings,
  Cpu,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "LiTT Terminal", icon: Terminal, href: "/studio" },
  { label: "Files", icon: FolderOpen, href: "/studio" },
  { label: "Agents", icon: Bot, href: "/agents" },
  { label: "Deployments", icon: Rocket, href: "/deployments" },
  { label: "API Keys", icon: Key, href: "/settings?tab=cli" },
  { label: "Billing", icon: CreditCard, href: "/wallet" },
  { label: "Marketplace", icon: Store, href: "/marketplace" },
  { label: "Docs", icon: BookOpen, href: "/docs" },
];

const systemItems = [
  { label: "System", icon: Cpu, href: "/admin" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export function LeftSidebar({ mobileOpen }: { mobileOpen?: boolean }) {
  const { user, isLoaded } = useUser();
  const pathname = usePathname();

  return (
    <aside
      className={`flex-col border-r border-neutral-900 bg-[#0a0a0b] p-4 lg:flex ${
        mobileOpen ? "flex fixed inset-y-0 left-0 z-50 w-[260px]" : "hidden"
      }`}
    >
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-xs font-black">
          L
        </div>
        <div className="text-orange-500 font-black tracking-wide">
          LiTT Code
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto">
        <div className="space-y-1">
          <div className="px-3 text-[10px] font-black uppercase tracking-wider text-neutral-600">
            Workspace
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              pathname.startsWith(item.href.split("?")[0]);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-orange-600/20 text-orange-400 border border-orange-600/20"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="space-y-1">
          <div className="px-3 text-[10px] font-black uppercase tracking-wider text-neutral-600">
            System
          </div>
          {systemItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-auto border-t border-neutral-900 pt-4">
        {isLoaded && user ? (
          <div className="flex items-center gap-3 rounded-lg bg-neutral-900/50 p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-red-600 text-xs font-bold">
              {user.firstName?.[0] || user.username?.[0] || "U"}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-sm font-semibold">
                {user.fullName || user.username || "User"}
              </div>
              <div className="truncate text-[10px] text-neutral-500">
                {user.primaryEmailAddress?.emailAddress}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-orange-400">
                {(user.publicMetadata as { role?: string } | undefined)?.role ||
                  "user"}
              </div>
            </div>
            <Link
              href="/sign-in"
              className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="text-xs text-neutral-500">Loading user...</div>
        )}
      </div>
    </aside>
  );
}
