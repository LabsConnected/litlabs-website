"use client";

import { useState, useCallback } from "react";
import type { CanvasBlock } from "@/lib/canvas/types";
import type {
  NavbarContent,
  HeroContent,
  FeaturesContent,
  PricingContent,
  CtaContent,
  FooterContent,
  GalleryContent,
  TestimonialContent,
} from "@/lib/canvas/types";
import { cn } from "@/lib/utils";

// ─── Shared types ───────────────────────────────────────────────

interface WebsiteBlockProps {
  block: CanvasBlock;
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  readOnly?: boolean;
}

// Inline editable text helper
function EditableText({
  value,
  onChange,
  readOnly,
  className,
  as: Tag = "span",
  placeholder = "Click to edit...",
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  className?: string;
  as?: React.ElementType;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);

  const save = useCallback(() => {
    setEditing(false);
    if (text !== value) onChange(text);
  }, [text, value, onChange]);

  if (editing && !readOnly) {
    return (
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setText(value); setEditing(false); } }}
        className={cn("bg-transparent outline-none ring-1 ring-violet-500/40 rounded px-1 -mx-1", className)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <Tag
      className={cn(!readOnly && "cursor-text hover:bg-white/5 rounded px-1 -mx-1 transition-colors", className)}
      onClick={() => !readOnly && setEditing(true)}
    >
      {value || (!readOnly ? placeholder : "")}
    </Tag>
  );
}

// Block wrapper with delete button + drag handle
function WebsiteBlockWrapper({
  block,
  onDelete,
  readOnly,
  children,
  className,
  label,
}: {
  block: CanvasBlock;
  onDelete: () => void;
  readOnly?: boolean;
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      className={cn(
        "group relative rounded-xl border border-white/5 transition-all hover:border-violet-500/20",
        className,
      )}
      data-block-id={block.id}
      data-block-type={block.type}
    >
      {/* Hover toolbar */}
      {!readOnly && (
        <div className="absolute -top-3 right-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-medium text-violet-300">
            {label}
          </span>
          <button
            onClick={onDelete}
            className="rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-medium text-red-300 hover:bg-red-500/30"
            aria-label="Delete block"
          >
            ✕
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Navbar ─────────────────────────────────────────────────────

export function NavbarBlock({ block, onUpdate, onDelete, readOnly }: WebsiteBlockProps) {
  const content = block.content as unknown as NavbarContent;
  const links = content.links ?? [];

  return (
    <WebsiteBlockWrapper block={block} onDelete={onDelete} readOnly={readOnly} label="NAVBAR" className="bg-[#0a0a0f]/80 backdrop-blur-sm">
      <nav className="flex items-center justify-between px-6 py-3">
        <EditableText
          value={content.brand}
          onChange={(v) => onUpdate({ brand: v })}
          readOnly={readOnly}
          className="text-base font-bold text-white"
        />
        <div className="flex items-center gap-5">
          {links.map((link, i) => (
            <span key={i} className="text-xs text-white/60 hover:text-white transition-colors">
              {link.label}
            </span>
          ))}
          <span className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white">
            {content.ctaLabel}
          </span>
        </div>
      </nav>
    </WebsiteBlockWrapper>
  );
}

// ─── Hero ───────────────────────────────────────────────────────

export function HeroBlock({ block, onUpdate, onDelete, readOnly }: WebsiteBlockProps) {
  const content = block.content as unknown as HeroContent;

  return (
    <WebsiteBlockWrapper block={block} onDelete={onDelete} readOnly={readOnly} label="HERO" className={cn("overflow-hidden", content.bgGradient && "bg-gradient-to-br from-violet-600/20 via-[#0a0a0f] to-cyan-600/10")}>
      <div className="px-6 py-16 text-center">
        {content.badge && (
          <div className="mb-4">
            <span className="inline-block rounded-full bg-violet-500/20 px-3 py-1 text-[10px] font-medium text-violet-300">
              <EditableText value={content.badge} onChange={(v) => onUpdate({ badge: v })} readOnly={readOnly} />
            </span>
          </div>
        )}
        <EditableText
          as="h1"
          value={content.title}
          onChange={(v) => onUpdate({ title: v })}
          readOnly={readOnly}
          className="block text-3xl font-bold text-white mb-3"
        />
        <EditableText
          as="p"
          value={content.subtitle}
          onChange={(v) => onUpdate({ subtitle: v })}
          readOnly={readOnly}
          className="block text-sm text-white/60 mb-6 max-w-md mx-auto"
        />
        <div className="flex items-center justify-center gap-3">
          <span className="rounded-lg bg-violet-500 px-5 py-2.5 text-sm font-medium text-white">
            {content.primaryLabel}
          </span>
          {content.secondaryLabel && (
            <span className="rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-white/80">
              {content.secondaryLabel}
            </span>
          )}
        </div>
      </div>
    </WebsiteBlockWrapper>
  );
}

// ─── Features ───────────────────────────────────────────────────

export function FeaturesBlock({ block, onUpdate, onDelete, readOnly }: WebsiteBlockProps) {
  const content = block.content as unknown as FeaturesContent;
  const items = content.items ?? [];
  const cols = content.columns ?? 3;
  const gridClass = cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-1 md:grid-cols-3";

  return (
    <WebsiteBlockWrapper block={block} onDelete={onDelete} readOnly={readOnly} label="FEATURES" className="bg-[#0a0a0f]">
      <div className="px-6 py-12">
        <div className="text-center mb-8">
          <EditableText
            as="h2"
            value={content.title}
            onChange={(v) => onUpdate({ title: v })}
            readOnly={readOnly}
            className="block text-xl font-bold text-white mb-2"
          />
          <EditableText
            as="p"
            value={content.subtitle}
            onChange={(v) => onUpdate({ subtitle: v })}
            readOnly={readOnly}
            className="block text-sm text-white/50"
          />
        </div>
        <div className={cn("grid gap-4", gridClass)}>
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <div className="text-2xl mb-2">{item.icon}</div>
              <div className="text-sm font-semibold text-white mb-1">{item.title}</div>
              <div className="text-xs text-white/50 leading-relaxed">{item.description}</div>
            </div>
          ))}
        </div>
      </div>
    </WebsiteBlockWrapper>
  );
}

// ─── Pricing ────────────────────────────────────────────────────

export function PricingBlock({ block, onUpdate, onDelete, readOnly }: WebsiteBlockProps) {
  const content = block.content as unknown as PricingContent;
  const tiers = content.tiers ?? [];

  return (
    <WebsiteBlockWrapper block={block} onDelete={onDelete} readOnly={readOnly} label="PRICING" className="bg-[#0a0a0f]">
      <div className="px-6 py-12">
        <div className="text-center mb-8">
          <EditableText
            as="h2"
            value={content.title}
            onChange={(v) => onUpdate({ title: v })}
            readOnly={readOnly}
            className="block text-xl font-bold text-white mb-2"
          />
          <EditableText
            as="p"
            value={content.subtitle}
            onChange={(v) => onUpdate({ subtitle: v })}
            readOnly={readOnly}
            className="block text-sm text-white/50"
          />
        </div>
        <div className={cn("grid gap-4 mx-auto max-w-4xl", tiers.length <= 2 ? "grid-cols-2" : tiers.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
          {tiers.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                "rounded-xl border p-5 relative",
                tier.highlighted
                  ? "border-violet-500/40 bg-violet-500/[0.05] shadow-lg shadow-violet-500/10"
                  : "border-white/5 bg-white/[0.02]",
              )}
            >
              {tier.highlighted && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-violet-500 px-2.5 py-0.5 text-[9px] font-bold text-white">
                  POPULAR
                </span>
              )}
              <div className="text-sm font-semibold text-white mb-1">{tier.name}</div>
              <div className="flex items-baseline gap-0.5 mb-2">
                <span className="text-2xl font-bold text-white">{tier.price}</span>
                {tier.period && <span className="text-xs text-white/40">{tier.period}</span>}
              </div>
              <div className="text-xs text-white/50 mb-3">{tier.description}</div>
              <ul className="space-y-1.5 mb-4">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-white/70">
                    <span className="text-violet-400 mt-0.5">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div
                className={cn(
                  "block w-full rounded-lg py-2 text-center text-xs font-medium transition-colors",
                  tier.highlighted
                    ? "bg-violet-500 text-white"
                    : "border border-white/15 text-white/80 hover:bg-white/5",
                )}
              >
                {tier.ctaLabel}
              </div>
            </div>
          ))}
        </div>
      </div>
    </WebsiteBlockWrapper>
  );
}

// ─── CTA ────────────────────────────────────────────────────────

export function CtaBlock({ block, onUpdate, onDelete, readOnly }: WebsiteBlockProps) {
  const content = block.content as unknown as CtaContent;

  return (
    <WebsiteBlockWrapper block={block} onDelete={onDelete} readOnly={readOnly} label="CTA" className="bg-gradient-to-r from-violet-600/20 to-cyan-600/10">
      <div className="px-6 py-12 text-center">
        <EditableText
          as="h2"
          value={content.title}
          onChange={(v) => onUpdate({ title: v })}
          readOnly={readOnly}
          className="block text-xl font-bold text-white mb-2"
        />
        <EditableText
          as="p"
          value={content.subtitle}
          onChange={(v) => onUpdate({ subtitle: v })}
          readOnly={readOnly}
          className="block text-sm text-white/60 mb-5"
        />
        <span className="inline-block rounded-lg bg-violet-500 px-6 py-2.5 text-sm font-medium text-white">
          {content.label}
        </span>
      </div>
    </WebsiteBlockWrapper>
  );
}

// ─── Footer ─────────────────────────────────────────────────────

export function FooterBlock({ block, onUpdate, onDelete, readOnly }: WebsiteBlockProps) {
  const content = block.content as unknown as FooterContent;
  const links = content.links ?? [];

  return (
    <WebsiteBlockWrapper block={block} onDelete={onDelete} readOnly={readOnly} label="FOOTER" className="bg-[#08080c]">
      <div className="px-6 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <EditableText
              value={content.brand}
              onChange={(v) => onUpdate({ brand: v })}
              readOnly={readOnly}
              className="text-sm font-bold text-white"
            />
            <EditableText
              as="p"
              value={content.description}
              onChange={(v) => onUpdate({ description: v })}
              readOnly={readOnly}
              className="block text-xs text-white/40 mt-1.5 leading-relaxed"
            />
          </div>
          <div className="flex flex-wrap gap-4">
            {links.map((link, i) => (
              <span key={i} className="text-xs text-white/50 hover:text-white/80 transition-colors">
                {link.label}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-6 border-t border-white/5 pt-4">
          <EditableText
            as="p"
            value={content.copyright}
            onChange={(v) => onUpdate({ copyright: v })}
            readOnly={readOnly}
            className="block text-[10px] text-white/30"
          />
        </div>
      </div>
    </WebsiteBlockWrapper>
  );
}

// ─── Gallery ────────────────────────────────────────────────────

export function GalleryBlock({ block, onUpdate, onDelete, readOnly }: WebsiteBlockProps) {
  const content = block.content as unknown as GalleryContent;
  const images = content.images ?? [];
  const cols = content.columns ?? 3;
  const gridClass = cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3";

  return (
    <WebsiteBlockWrapper block={block} onDelete={onDelete} readOnly={readOnly} label="GALLERY" className="bg-[#0a0a0f]">
      <div className="px-6 py-12">
        <div className="text-center mb-6">
          <EditableText
            as="h2"
            value={content.title}
            onChange={(v) => onUpdate({ title: v })}
            readOnly={readOnly}
            className="block text-xl font-bold text-white mb-1"
          />
          <EditableText
            as="p"
            value={content.subtitle}
            onChange={(v) => onUpdate({ subtitle: v })}
            readOnly={readOnly}
            className="block text-sm text-white/50"
          />
        </div>
        <div className={cn("grid gap-3", gridClass)}>
          {images.map((img, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={img.url}
              alt={img.alt}
              className="rounded-lg w-full h-40 object-cover border border-white/5"
            />
          ))}
        </div>
      </div>
    </WebsiteBlockWrapper>
  );
}

// ─── Testimonial ────────────────────────────────────────────────

export function TestimonialBlock({ block, onUpdate, onDelete, readOnly }: WebsiteBlockProps) {
  const content = block.content as unknown as TestimonialContent;
  const items = content.items ?? [];

  return (
    <WebsiteBlockWrapper block={block} onDelete={onDelete} readOnly={readOnly} label="TESTIMONIALS" className="bg-[#0a0a0f]">
      <div className="px-6 py-12">
        <div className="text-center mb-6">
          <EditableText
            as="h2"
            value={content.title}
            onChange={(v) => onUpdate({ title: v })}
            readOnly={readOnly}
            className="block text-xl font-bold text-white mb-1"
          />
          <EditableText
            as="p"
            value={content.subtitle}
            onChange={(v) => onUpdate({ subtitle: v })}
            readOnly={readOnly}
            className="block text-sm text-white/50"
          />
        </div>
        <div className={cn("grid gap-4", items.length <= 2 ? "grid-cols-2" : "grid-cols-3")}>
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <div className="text-xs text-white/80 leading-relaxed italic mb-3">
                &ldquo;{item.quote}&rdquo;
              </div>
              <div className="flex items-center gap-2">
                {item.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.avatar} alt={item.author} className="h-7 w-7 rounded-full" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-violet-500/20 grid place-items-center text-[10px] font-bold text-violet-300">
                    {item.author.charAt(0)}
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium text-white">{item.author}</div>
                  {item.role && <div className="text-[10px] text-white/40">{item.role}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WebsiteBlockWrapper>
  );
}
