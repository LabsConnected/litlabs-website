"use client";

/**
 * ComposerContextStrip — the LiTT command bar's single thin context line.
 *
 * One task-aware line, no chrome:
 *   Design · HeroSection · h2 · Desktop
 *   Preview · PricingCard · section · Mobile
 *   Code · my-project
 *
 * Parts: active surface label, selected component/element, viewport.
 * Without a selection it falls back to surface + project.
 */

export interface ComposerContextStripProps {
  surfaceLabel: string;
  /** Component name (builder componentName, or the selection label). */
  componentName?: string | null;
  /** Element tag (h2, section, img, …). */
  tagName?: string | null;
  /** Viewport label (Desktop, Tablet, Mobile) — visual surfaces only. */
  viewport?: string | null;
  /** Shown when nothing is selected. */
  projectName?: string | null;
  className?: string;
}

export default function ComposerContextStrip({
  surfaceLabel,
  componentName,
  tagName,
  viewport,
  projectName,
  className,
}: ComposerContextStripProps) {
  const parts: string[] = [surfaceLabel];
  if (componentName) parts.push(componentName);
  if (tagName) parts.push(tagName);
  if (viewport) parts.push(viewport);
  if (parts.length === 1 && projectName) parts.push(projectName);

  return (
    <div
      className={`flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap px-1 text-[10px] font-medium ${className ?? ""}`}
      style={{ color: "var(--text-muted)" }}
      data-testid="composer-context-strip"
      aria-label={`Current context: ${parts.join(", ")}`}
    >
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="flex min-w-0 shrink-0 items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden style={{ color: "var(--studio-border-strong)" }}>·</span>
          )}
          <span className={i === 0 ? "font-bold" : "truncate"} style={i === 0 ? { color: "var(--text-secondary)" } : undefined}>
            {part}
          </span>
        </span>
      ))}
    </div>
  );
}
