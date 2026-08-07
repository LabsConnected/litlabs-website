/**
 * Canvas → Code generator.
 *
 * Converts a list of CanvasBlock objects into a single React component
 * string using Tailwind CSS classes. The output is a self-contained
 * .tsx file that can be written to a project workspace and previewed.
 */

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
  HeadingContent,
  ParagraphContent,
  CodeContent,
} from "@/lib/canvas/types";

// ─── Helpers ────────────────────────────────────────────────────

function esc(s: string): string {
  return (s ?? "").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function indent(lines: string[], spaces = 4): string {
  const pad = " ".repeat(spaces);
  return lines.map((l) => (l.length > 0 ? pad + l : l)).join("\n");
}

// ─── Per-block code generators ──────────────────────────────────

function genNavbar(block: CanvasBlock, c: NavbarContent): string {
  const links = (c.links ?? []).map((l) =>
    `        <a href="${esc(l.href)}" className="text-sm text-white/60 hover:text-white transition-colors">${esc(l.label)}</a>`,
  ).join("\n");
  return `<nav className="flex items-center justify-between px-6 py-3 bg-[#0a0a0f]/80 backdrop-blur-sm">
  <span className="text-base font-bold text-white">${esc(c.brand)}</span>
  <div className="flex items-center gap-5">
${links}
    <a href="${esc(c.ctaHref)}" className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 transition-colors">
      ${esc(c.ctaLabel)}
    </a>
  </div>
</nav>`;
}

function genHero(block: CanvasBlock, c: HeroContent): string {
  const badge = c.badge
    ? `      <span className="inline-block rounded-full bg-violet-500/20 px-3 py-1 text-xs font-medium text-violet-300 mb-4">\n        ${esc(c.badge)}\n      </span>\n`
    : "";
  const gradient = c.bgGradient ? "bg-gradient-to-br from-violet-600/20 via-[#0a0a0f] to-cyan-600/10" : "bg-[#0a0a0f]";
  const secondary = c.secondaryLabel
    ? `\n      <a href="${esc(c.secondaryHref)}" className="rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-white/80 hover:bg-white/5 transition-colors">
        ${esc(c.secondaryLabel)}
      </a>`
    : "";
  return `<section className="${gradient}">
  <div className="px-6 py-20 text-center">
${badge}    <h1 className="text-4xl font-bold text-white mb-4">${esc(c.title)}</h1>
    <p className="text-base text-white/60 mb-8 max-w-lg mx-auto">${esc(c.subtitle)}</p>
    <div className="flex items-center justify-center gap-3">
      <a href="${esc(c.primaryHref)}" className="rounded-lg bg-violet-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-600 transition-colors">
        ${esc(c.primaryLabel)}
      </a>${secondary}
    </div>
  </div>
</section>`;
}

function genFeatures(block: CanvasBlock, c: FeaturesContent): string {
  const cols = c.columns ?? 3;
  const gridClass = cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-1 md:grid-cols-3";
  const items = (c.items ?? []).map((item) =>
    `      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
        <div className="text-2xl mb-2">${esc(item.icon)}</div>
        <h3 className="text-sm font-semibold text-white mb-1">${esc(item.title)}</h3>
        <p className="text-xs text-white/50 leading-relaxed">${esc(item.description)}</p>
      </div>`,
  ).join("\n");
  return `<section className="bg-[#0a0a0f] py-16">
  <div className="px-6">
    <div className="text-center mb-10">
      <h2 className="text-2xl font-bold text-white mb-2">${esc(c.title)}</h2>
      <p className="text-sm text-white/50">${esc(c.subtitle)}</p>
    </div>
    <div className="grid gap-4 ${gridClass} max-w-4xl mx-auto">
${items}
    </div>
  </div>
</section>`;
}

function genPricing(block: CanvasBlock, c: PricingContent): string {
  const tiers = (c.tiers ?? []).map((tier) => {
    const features = (tier.features ?? []).map((f) =>
      `        <li className="flex items-start gap-1.5 text-xs text-white/70"><span className="text-violet-400 mt-0.5">✓</span><span>${esc(f)}</span></li>`,
    ).join("\n");
    const highlighted = tier.highlighted
      ? "border-violet-500/40 bg-violet-500/[0.05] shadow-lg shadow-violet-500/10"
      : "border-white/5 bg-white/[0.02]";
    const badge = tier.highlighted
      ? `        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-violet-500 px-2.5 py-0.5 text-[10px] font-bold text-white">POPULAR</span>\n`
      : "";
    const ctaClass = tier.highlighted ? "bg-violet-500 text-white" : "border border-white/15 text-white/80 hover:bg-white/5";
    return `      <div className="rounded-xl border p-5 relative ${highlighted}">
${badge}        <div className="text-sm font-semibold text-white mb-1">${esc(tier.name)}</div>
        <div className="flex items-baseline gap-0.5 mb-2">
          <span className="text-2xl font-bold text-white">${esc(tier.price)}</span>
          ${tier.period ? `<span className="text-xs text-white/40">${esc(tier.period)}</span>` : ""}
        </div>
        <p className="text-xs text-white/50 mb-3">${esc(tier.description)}</p>
        <ul className="space-y-1.5 mb-4">
${features}
        </ul>
        <a href="${esc(tier.ctaHref)}" className="block w-full rounded-lg py-2 text-center text-xs font-medium transition-colors ${ctaClass}">
          ${esc(tier.ctaLabel)}
        </a>
      </div>`;
  }).join("\n");
  const gridClass = (c.tiers ?? []).length <= 2 ? "grid-cols-2" : (c.tiers ?? []).length === 3 ? "grid-cols-3" : "grid-cols-4";
  return `<section className="bg-[#0a0a0f] py-16">
  <div className="px-6">
    <div className="text-center mb-10">
      <h2 className="text-2xl font-bold text-white mb-2">${esc(c.title)}</h2>
      <p className="text-sm text-white/50">${esc(c.subtitle)}</p>
    </div>
    <div className="grid gap-4 ${gridClass} max-w-4xl mx-auto">
${tiers}
    </div>
  </div>
</section>`;
}

function genCta(block: CanvasBlock, c: CtaContent): string {
  return `<section className="bg-gradient-to-r from-violet-600/20 to-cyan-600/10 py-16">
  <div className="px-6 text-center">
    <h2 className="text-2xl font-bold text-white mb-2">${esc(c.title)}</h2>
    <p className="text-sm text-white/60 mb-6">${esc(c.subtitle)}</p>
    <a href="${esc(c.href)}" className="inline-block rounded-lg bg-violet-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-600 transition-colors">
      ${esc(c.label)}
    </a>
  </div>
</section>`;
}

function genFooter(block: CanvasBlock, c: FooterContent): string {
  const links = (c.links ?? []).map((l) =>
    `        <a href="${esc(l.href)}" className="text-xs text-white/50 hover:text-white/80 transition-colors">${esc(l.label)}</a>`,
  ).join("\n");
  return `<footer className="bg-[#08080c] py-8 px-6">
  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
    <div className="max-w-xs">
      <div className="text-sm font-bold text-white">${esc(c.brand)}</div>
      <p className="text-xs text-white/40 mt-1.5 leading-relaxed">${esc(c.description)}</p>
    </div>
    <div className="flex flex-wrap gap-4">
${links}
    </div>
  </div>
  <div className="mt-6 border-t border-white/5 pt-4">
    <p className="text-[10px] text-white/30">${esc(c.copyright)}</p>
  </div>
</footer>`;
}

function genGallery(block: CanvasBlock, c: GalleryContent): string {
  const cols = c.columns ?? 3;
  const gridClass = cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3";
  const images = (c.images ?? []).map((img) =>
    `      {/* eslint-disable-next-line @next/next/no-img-element */}\n      <img src="${esc(img.url)}" alt="${esc(img.alt)}" className="rounded-lg w-full h-40 object-cover border border-white/5" />`,
  ).join("\n");
  return `<section className="bg-[#0a0a0f] py-16">
  <div className="px-6">
    <div className="text-center mb-8">
      <h2 className="text-2xl font-bold text-white mb-1">${esc(c.title)}</h2>
      <p className="text-sm text-white/50">${esc(c.subtitle)}</p>
    </div>
    <div className="grid gap-3 ${gridClass} max-w-4xl mx-auto">
${images}
    </div>
  </div>
</section>`;
}

function genTestimonial(block: CanvasBlock, c: TestimonialContent): string {
  const items = (c.items ?? []).map((item) => {
    const avatar = item.avatar
      ? `        {/* eslint-disable-next-line @next/next/no-img-element */}\n        <img src="${esc(item.avatar)}" alt="${esc(item.author)}" className="h-7 w-7 rounded-full" />`
      : `        <div className="h-7 w-7 rounded-full bg-violet-500/20 grid place-items-center text-[10px] font-bold text-violet-300">${esc(item.author.charAt(0))}</div>`;
    return `      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <p className="text-xs text-white/80 leading-relaxed italic mb-3">&ldquo;${esc(item.quote)}&rdquo;</p>
        <div className="flex items-center gap-2">
${avatar}
          <div>
            <div className="text-xs font-medium text-white">${esc(item.author)}</div>
            ${item.role ? `<div className="text-[10px] text-white/40">${esc(item.role)}</div>` : ""}
          </div>
        </div>
      </div>`;
  }).join("\n");
  const gridClass = (c.items ?? []).length <= 2 ? "grid-cols-2" : "grid-cols-3";
  return `<section className="bg-[#0a0a0f] py-16">
  <div className="px-6">
    <div className="text-center mb-8">
      <h2 className="text-2xl font-bold text-white mb-1">${esc(c.title)}</h2>
      <p className="text-sm text-white/50">${esc(c.subtitle)}</p>
    </div>
    <div className="grid gap-4 ${gridClass} max-w-4xl mx-auto">
${items}
    </div>
  </div>
</section>`;
}

function genHeading(block: CanvasBlock, c: HeadingContent): string {
  const level = c.level ?? 2;
  const sizes: Record<number, string> = { 1: "text-3xl", 2: "text-2xl", 3: "text-xl", 4: "text-lg", 5: "text-base", 6: "text-sm" };
  const tag = `h${Math.min(Math.max(level, 1), 6)}`;
  return `<${tag} className="${sizes[level] ?? "text-base"} font-bold text-white">${esc(c.text)}</${tag}>`;
}

function genParagraph(block: CanvasBlock, c: ParagraphContent): string {
  return `<p className="text-sm text-white/80 leading-relaxed">${esc(c.text)}</p>`;
}

function genCode(block: CanvasBlock, c: CodeContent): string {
  return `<pre className="overflow-x-auto rounded-lg border border-white/5 bg-black/40 p-4 text-xs font-mono text-white/80"><code>${esc(c.code)}</code></pre>`;
}

// ─── Main generator ─────────────────────────────────────────────

/** Generate a full React component from canvas blocks. */
export function generateComponent(blocks: CanvasBlock[], componentName = "CanvasPage"): string {
  const sections: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "navbar": sections.push(genNavbar(block, block.content as unknown as NavbarContent)); break;
      case "hero": sections.push(genHero(block, block.content as unknown as HeroContent)); break;
      case "features": sections.push(genFeatures(block, block.content as unknown as FeaturesContent)); break;
      case "pricing": sections.push(genPricing(block, block.content as unknown as PricingContent)); break;
      case "cta": sections.push(genCta(block, block.content as unknown as CtaContent)); break;
      case "footer": sections.push(genFooter(block, block.content as unknown as FooterContent)); break;
      case "gallery": sections.push(genGallery(block, block.content as unknown as GalleryContent)); break;
      case "testimonial": sections.push(genTestimonial(block, block.content as unknown as TestimonialContent)); break;
      case "heading": sections.push(genHeading(block, block.content as unknown as HeadingContent)); break;
      case "paragraph": sections.push(genParagraph(block, block.content as unknown as ParagraphContent)); break;
      case "code": sections.push(genCode(block, block.content as unknown as CodeContent)); break;
      // Skip non-visual blocks (checklist, task, note, decision, image, file, preview)
      default: break;
    }
  }

  const body = sections.join("\n\n");

  return `// Generated by LiTTree Canvas Builder
// Component: ${componentName}
// Blocks: ${blocks.length}
// Generated: ${new Date().toISOString()}

export default function ${componentName}() {
  return (
    <div className="min-h-screen bg-[#08060f] text-white">
${indent(body.split("\n"), 6)}
    </div>
  );
}
`;
}

/** Generate a standalone HTML preview (for iframe rendering). */
export function generatePreviewHTML(blocks: CanvasBlock[]): string {
  const sections: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "navbar": sections.push(genNavbar(block, block.content as unknown as NavbarContent)); break;
      case "hero": sections.push(genHero(block, block.content as unknown as HeroContent)); break;
      case "features": sections.push(genFeatures(block, block.content as unknown as FeaturesContent)); break;
      case "pricing": sections.push(genPricing(block, block.content as unknown as PricingContent)); break;
      case "cta": sections.push(genCta(block, block.content as unknown as CtaContent)); break;
      case "footer": sections.push(genFooter(block, block.content as unknown as FooterContent)); break;
      case "gallery": sections.push(genGallery(block, block.content as unknown as GalleryContent)); break;
      case "testimonial": sections.push(genTestimonial(block, block.content as unknown as TestimonialContent)); break;
      case "heading": sections.push(genHeading(block, block.content as unknown as HeadingContent)); break;
      case "paragraph": sections.push(genParagraph(block, block.content as unknown as ParagraphContent)); break;
      case "code": sections.push(genCode(block, block.content as unknown as CodeContent)); break;
      default: break;
    }
  }

  const body = sections.join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Canvas Preview</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{background:#08060f;}</style>
</head>
<body class="min-h-screen text-white">
${body}
</body>
</html>`;
}
