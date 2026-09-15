"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { DOCS_NAV, docsPrevNext } from "./docs-nav";

/**
 * DocsShell — shared layout for every /docs route.
 *
 * - Desktop (lg+): sticky left sidebar with grouped navigation.
 * - Mobile: a collapsible "In this guide" panel; prev/next pager at the
 *   bottom keeps the reading order reachable without the sidebar.
 * - A <nav> landmark and <article> content — LayoutShell already renders
 *   the single <main> landmark, so nothing here may be a <main>.
 * - pt-28/pt-32 clears the fixed 68px MarketingHeader (same offset the old
 *   docs landing used).
 */
export default function DocsShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { resolvedColors: T } = useTheme();
  const pathname = usePathname() ?? "";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { prev, next } = docsPrevNext(pathname);

  const isActive = (href: string) =>
    href === "/docs" ? pathname === "/docs" : pathname === href || pathname.startsWith(href + "/");

  const navList = (
    <nav aria-label="Documentation sections" className="w-full">
      {DOCS_NAV.map((group) => (
        <div key={group.label} className="mb-6">
          <p
            className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.22em]"
            style={{ color: T.accentColor }}
          >
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.pages.map((page) => {
              const active = isActive(page.href);
              return (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileNavOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm transition-colors"
                    style={{
                      color: active ? T.headerColor : T.textColor,
                      backgroundColor: active ? `${T.accentColor}18` : "transparent",
                      fontWeight: active ? 700 : 400,
                      opacity: active ? 1 : 0.75,
                    }}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div
      className="min-h-screen px-4 pb-16 pt-28 sm:pt-32"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      <div className="mx-auto max-w-6xl">
        {/* Mobile section nav — collapsed by default */}
        <div className="mb-6 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-expanded={mobileNavOpen}
            aria-controls="docs-mobile-nav"
            data-testid="docs-mobile-nav-toggle"
            className="flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm font-bold"
            style={{
              backgroundColor: T.boxBg,
              borderColor: T.borderColor,
              color: T.headerColor,
            }}
          >
            <span className="inline-flex items-center gap-2">
              <BookOpen size={16} style={{ color: T.accentColor }} />
              In this guide
            </span>
            <ChevronDown
              size={16}
              className={`transition-transform ${mobileNavOpen ? "rotate-180" : ""}`}
            />
          </button>
          {mobileNavOpen && (
            <div
              id="docs-mobile-nav"
              data-testid="docs-mobile-nav"
              className="mt-2 rounded-xl border p-4"
              style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
            >
              {navList}
            </div>
          )}
        </div>

        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
          {/* Desktop sidebar */}
          <aside
            className="hidden lg:block"
            data-testid="docs-desktop-sidebar"
          >
            <div className="sticky top-28 max-h-[calc(100vh-9rem)] overflow-y-auto pb-8">
              {navList}
            </div>
          </aside>

          {/* Article */}
          <article className="min-w-0 max-w-3xl" data-testid="docs-article">
            {children}

            {/* Prev / next pager */}
            <div
              className="mt-12 grid gap-3 border-t pt-6 sm:grid-cols-2"
              style={{ borderColor: T.borderColor }}
            >
              {prev ? (
                <Link
                  href={prev.href}
                  className="group rounded-xl border p-4 transition-all hover:-translate-y-0.5"
                  style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
                >
                  <span
                    className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.2em] opacity-60"
                    style={{ color: T.textColor }}
                  >
                    <ArrowLeft size={12} /> Previous
                  </span>
                  <span
                    className="text-sm font-bold"
                    style={{ color: T.headerColor }}
                  >
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={next.href}
                  className="group rounded-xl border p-4 text-right transition-all hover:-translate-y-0.5"
                  style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
                >
                  <span
                    className="mb-1 flex items-center justify-end gap-1 text-[10px] font-black uppercase tracking-[0.2em] opacity-60"
                    style={{ color: T.textColor }}
                  >
                    Next <ArrowRight size={12} />
                  </span>
                  <span
                    className="text-sm font-bold"
                    style={{ color: T.headerColor }}
                  >
                    {next.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
