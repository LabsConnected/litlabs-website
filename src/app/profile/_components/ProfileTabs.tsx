"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
  { id: "agents", label: "Agents" },
  { id: "artifacts", label: "Artifacts" },
  { id: "posts", label: "Posts" },
  { id: "activity", label: "Activity" },
  { id: "about", label: "About" },
];

export function ProfileTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = searchParams.get("tab") || "overview";

  const go = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", id);
      router.push(`/profile?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div className="profile-tabs-wrap">
      <div className="profile-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            aria-current={active === t.id ? "page" : undefined}
            onClick={() => go(t.id)}
            className="profile-tab"
            data-active={String(active === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <style>{`
        .profile-tabs-wrap {
          position: sticky;
          top: 0;
          z-index: 20;
          background: rgba(7,7,11,0.88);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          margin: 0 -28px;
          padding: 0 28px;
        }
        @media (max-width: 767px) {
          .profile-tabs-wrap { margin: 0 -12px; padding: 0 12px; }
        }
        .profile-tabs {
          display: flex;
          align-items: center;
          gap: 0;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .profile-tabs::-webkit-scrollbar { display: none; }
        .profile-tab {
          position: relative;
          min-height: 48px;
          padding: 0 16px;
          border: none;
          background: transparent;
          color: #71717a;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: color 180ms;
          flex-shrink: 0;
        }
        .profile-tab:hover { color: #a1a1aa; }
        .profile-tab[data-active="true"] { color: #c084fc; }
        .profile-tab[data-active="true"]::after {
          content: '';
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: 0;
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, #a855f7, #30e7ff);
        }
      `}</style>
    </div>
  );
}
