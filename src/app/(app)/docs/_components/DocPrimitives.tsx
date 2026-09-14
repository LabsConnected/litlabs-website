"use client";

import { useTheme } from "@/context/ThemeContext";
import { AlertTriangle, Info, Lightbulb } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared docs content primitives. All styling goes through the theme so
 * docs stay consistent with the site's dark premium UI in every theme.
 */

export function DocH1({ children }: { children: ReactNode }) {
  const { resolvedColors: T } = useTheme();
  return (
    <h1
      className="mb-4 text-3xl font-black tracking-tight md:text-4xl"
      style={{ color: T.headerColor }}
    >
      {children}
    </h1>
  );
}

export function DocIntro({ children }: { children: ReactNode }) {
  const { resolvedColors: T } = useTheme();
  return (
    <p
      className="mb-8 max-w-2xl text-base leading-relaxed opacity-70 md:text-lg"
      style={{ color: T.textColor }}
    >
      {children}
    </p>
  );
}

export function DocH2({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { resolvedColors: T } = useTheme();
  return (
    <h2
      id={id}
      className="mb-3 mt-10 scroll-mt-32 text-xl font-black tracking-tight md:text-2xl"
      style={{ color: T.headerColor }}
    >
      {children}
    </h2>
  );
}

export function DocH3({ children }: { children: ReactNode }) {
  const { resolvedColors: T } = useTheme();
  return (
    <h3
      className="mb-2 mt-6 text-base font-bold md:text-lg"
      style={{ color: T.headerColor }}
    >
      {children}
    </h3>
  );
}

export function DocP({ children }: { children: ReactNode }) {
  const { resolvedColors: T } = useTheme();
  return (
    <p
      className="mb-4 text-[15px] leading-relaxed opacity-80"
      style={{ color: T.textColor }}
    >
      {children}
    </p>
  );
}

export function DocList({ items }: { items: ReactNode[] }) {
  const { resolvedColors: T } = useTheme();
  return (
    <ul className="mb-4 space-y-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex gap-2.5 text-[15px] leading-relaxed opacity-80"
          style={{ color: T.textColor }}
        >
          <span
            aria-hidden
            className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: T.accentColor }}
          />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function CodeBlock({
  children,
  label,
}: {
  children: string;
  label?: string;
}) {
  const { resolvedColors: T } = useTheme();
  return (
    <div
      className="mb-4 overflow-hidden rounded-xl border"
      style={{ backgroundColor: "#05070d", borderColor: T.borderColor }}
    >
      {label && (
        <div
          className="border-b px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] opacity-60"
          style={{ borderColor: T.borderColor, color: T.textColor }}
        >
          {label}
        </div>
      )}
      {/* overflow-x-auto keeps long commands from pushing the page wider
          than the viewport on mobile */}
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code className="font-mono" style={{ color: "#d4d4e8" }}>
          {children}
        </code>
      </pre>
    </div>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  const { resolvedColors: T } = useTheme();
  return (
    <code
      className="rounded px-1.5 py-0.5 font-mono text-[13px] break-words"
      style={{ backgroundColor: `${T.accentColor}1a`, color: T.headerColor }}
    >
      {children}
    </code>
  );
}

/** A real example prompt the reader can copy and paste into Studio chat. */
export function ExamplePrompt({
  children,
  caption,
}: {
  children: string;
  caption?: string;
}) {
  const { resolvedColors: T } = useTheme();
  return (
    <figure
      className="mb-4 rounded-xl border-l-4 p-4"
      style={{
        backgroundColor: T.boxBg,
        borderColor: T.borderColor,
        borderLeftColor: T.accentColor,
      }}
    >
      {caption && (
        <figcaption
          className="mb-1.5 text-[11px] font-black uppercase tracking-[0.18em] opacity-60"
          style={{ color: T.textColor }}
        >
          {caption}
        </figcaption>
      )}
      <blockquote
        className="text-[14px] italic leading-relaxed opacity-85"
        style={{ color: T.textColor }}
      >
        “{children}”
      </blockquote>
    </figure>
  );
}

type CalloutKind = "note" | "tip" | "warning";

const CALLOUT_STYLE: Record<CalloutKind, { icon: typeof Info; color: string }> = {
  note: { icon: Info, color: "#38bdf8" },
  tip: { icon: Lightbulb, color: "#72f238" },
  warning: { icon: AlertTriangle, color: "#e3b341" },
};

export function Callout({
  kind = "note",
  title,
  children,
}: {
  kind?: CalloutKind;
  title?: string;
  children: ReactNode;
}) {
  const { resolvedColors: T } = useTheme();
  const { icon: Icon, color } = CALLOUT_STYLE[kind];
  return (
    <div
      className="mb-4 flex gap-3 rounded-xl border p-4"
      role="note"
      style={{ backgroundColor: `${color}0d`, borderColor: `${color}45` }}
    >
      <Icon size={18} className="mt-0.5 shrink-0" style={{ color }} />
      <div className="min-w-0 text-[14px] leading-relaxed" style={{ color: T.textColor }}>
        {title && (
          <p className="mb-1 font-bold" style={{ color }}>
            {title}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

/** Numbered steps for procedures like Quick Start. */
export function Steps({ steps }: { steps: { title: string; body: ReactNode }[] }) {
  const { resolvedColors: T } = useTheme();
  return (
    <ol className="mb-6 space-y-5">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-4">
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-black"
            style={{ backgroundColor: `${T.accentColor}20`, color: T.accentColor }}
          >
            {i + 1}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="mb-1 font-bold" style={{ color: T.headerColor }}>
              {step.title}
            </p>
            <div
              className="text-[14px] leading-relaxed opacity-80"
              style={{ color: T.textColor }}
            >
              {step.body}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Compact definition table: term on the left, explanation on the right. */
export function TermList({
  terms,
}: {
  terms: { term: ReactNode; definition: ReactNode }[];
}) {
  const { resolvedColors: T } = useTheme();
  return (
    <dl
      className="mb-6 divide-y overflow-hidden rounded-xl border"
      style={{ backgroundColor: T.boxBg, borderColor: T.borderColor, ["--tw-divide-opacity" as string]: 1 }}
    >
      {terms.map((row, i) => (
        <div key={i} className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4" style={{ borderColor: T.borderColor }}>
          <dt className="text-sm font-bold" style={{ color: T.headerColor }}>
            {row.term}
          </dt>
          <dd
            className="min-w-0 text-sm leading-relaxed opacity-80"
            style={{ color: T.textColor }}
          >
            {row.definition}
          </dd>
        </div>
      ))}
    </dl>
  );
}
