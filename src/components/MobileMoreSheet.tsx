"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  Bot,
  Coins,
  FolderGit2,
  FolderKanban,
  Gamepad2,
  Images,
  Settings,
  ShoppingBag,
  User,
  Users,
  WandSparkles,
  X,
} from "lucide-react";

type MobileMoreSheetProps = {
  open: boolean;
  onClose: () => void;
};

const GROUPS = [
  {
    label: "Create",
    items: [
      { label: "New project", href: "/projects?new=1", icon: FolderKanban },
      { label: "Create agent", href: "/agents?create=1", icon: Bot },
      { label: "Generate media", href: "/studio?intent=image", icon: WandSparkles },
    ],
  },
  {
    label: "Manage",
    items: [
      { label: "Projects", href: "/projects", icon: FolderKanban },
      { label: "Agents", href: "/agents", icon: Bot },
      { label: "Assets", href: "/gallery", icon: Images },
      { label: "GitHub connections", href: "/settings?tab=workspace", icon: FolderGit2 },
    ],
  },
  {
    label: "Explore",
    items: [
      { label: "Social", href: "/social", icon: Users },
      { label: "Games", href: "/games", icon: Gamepad2 },
      { label: "Marketplace", href: "/marketplace", icon: ShoppingBag },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/profile", icon: User },
      { label: "Credits", href: "/wallet", icon: Coins },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
] as const;

export default function MobileMoreSheet({ open, onClose }: MobileMoreSheetProps) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div
      className={`fixed inset-0 z-[120] h-[100dvh] md:hidden transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <button
        aria-label="Close menu"
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="More navigation"
        className={`absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto overscroll-contain rounded-t-[28px] border border-white/10 bg-[#090a10] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-24px_80px_rgba(0,0,0,.7)] transition-transform duration-300 ${open ? "translate-y-0" : "translate-y-full"}`}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-white">More</h2>
            <p className="text-[10px] text-white/40">Everything beyond your core workspace</p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-white/55" aria-label="Close more menu">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5">
          {GROUPS.map((group) => (
            <section key={group.label}>
              <h3 className="mb-2 px-1 text-[9px] font-black uppercase tracking-[.2em] text-white/35">{group.label}</h3>
              <div className="grid grid-cols-2 gap-2">
                {group.items.map((item) => (
                  <Link key={item.label} href={item.href} onClick={onClose} className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/8 bg-white/[.035] px-3 py-2.5 text-white/75 transition active:scale-[.98] active:bg-white/10">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-400/10 text-violet-200"><item.icon size={15} /></span>
                    <span className="text-[11px] font-bold leading-tight">{item.label}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
