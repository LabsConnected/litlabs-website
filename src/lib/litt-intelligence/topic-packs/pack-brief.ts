/**
 * Pack brief + skeleton + presence checklist.
 *
 * §4.3.1 — the brief is the pack rendered into compact prompt text:
 * required sections in order with minimums, required blocks with
 * fields, image subject lists, copy rules, SEO patterns, and the
 * skeleton plan (§4.3.2) the model fills in. Structure is guaranteed
 * by construction as far as a single compose call allows; validation
 * (§4.3.3) is the backstop.
 *
 * §4.6.4 — for Next.js projects the pack applies as a CHECKLIST:
 * checkPackPresence scans the files a run produced for each required
 * section/block and reports gaps — it never hard-fails a run.
 */

import type { SitePlan, SitePlanSection } from "../site-compose";
import type { BlockReq, PackSectionReq, TopicPack } from "./types";
import { normText } from "./pack-validation";

// ─── Skeleton (§4.3.2) ───────────────────────────────────────────────

function skeletonSection(req: PackSectionReq): SitePlanSection {
  const sec: SitePlanSection = {
    kind: req.kind,
    heading: req.headingHints[0] ?? req.label,
  };
  // Contact shells default to the natural phone/email/hours trio when
  // the pack sets no minimum — an empty items array fails structural
  // validation and teaches the model nothing.
  const n = Math.max(req.minItems ?? 0, req.kind === "contact" ? 3 : 0);
  if (["features", "services", "cards", "menu", "process", "stats", "contact"].includes(req.kind)) {
    sec.items = Array.from({ length: n }, () =>
      req.kind === "menu" ? { title: "", text: "", price: "" } : { title: "", text: "" },
    );
  } else if (req.kind === "faq") {
    sec.items = Array.from({ length: n }, () => ({ question: "", answer: "" }));
  } else if (req.kind === "testimonials") {
    sec.items = Array.from({ length: n }, () => ({ quote: "", author: "" }));
  } else if (req.kind === "gallery") {
    sec.images = [];
  } else if (req.kind === "pricing") {
    sec.plans = Array.from({ length: Math.max(req.minItems ?? 1, 1) }, () => ({ name: "", price: "", features: [] }));
  } else if (req.kind === "cta") {
    sec.button = "";
  } else if (req.kind === "hours") {
    sec.items = Array.from({ length: Math.max(n, 1) }, () => ({ day: "", hours: "" }));
  } else if (req.kind === "areas") {
    sec.items = Array.from({ length: Math.max(n, 3) }, () => ({ town: "" }));
  } else if (req.kind === "about" || req.kind === "text" || req.kind === "prose") {
    sec.text = "";
  }
  return sec;
}

function skeletonBlockSection(block: BlockReq, pack: TopicPack): SitePlanSection | null {
  switch (block.block) {
    case "form":
      return {
        kind: "form",
        formKind: block.formKind ?? "contact",
        heading: pack.hero.cta,
        fields: (block.fields ?? []).map((name) => ({ name, label: name, type: "text" })),
        button: "Send request",
      };
    case "booking":
      return {
        kind: "booking",
        formKind: block.formKind ?? "reservation",
        heading: "Book an appointment",
        fields: (block.fields ?? []).map((name) => ({ name, label: name, type: "text" })),
        button: "Request this time",
      };
    case "map":
      return { kind: "areas", heading: "Service area", items: [] };
    case "hours":
      return { kind: "hours", heading: "Hours", items: [{ day: "", hours: "" }] };
    case "gallery":
      return { kind: "gallery", heading: "Gallery", images: [...pack.images.required] };
    case "reviews":
      return {
        kind: "testimonials",
        heading: "Reviews",
        items: Array.from({ length: Math.max(pack.completeness.testimonialsMin, 1) }, () => ({ quote: "", author: "" })),
      };
    case "payments":
      return { kind: "pricing", heading: "Pricing", plans: [{ name: "", price: "", features: [] }] };
  }
}

/**
 * A plan skeleton built from the pack: required section kinds in pack
 * order with heading hints and empty item shells, plus any required
 * block not already covered by a required section. The model fills
 * copy and items into this shape.
 */
export function buildSkeletonPlan(pack: TopicPack): SitePlan {
  const sections: SitePlanSection[] = pack.requiredSections.map(skeletonSection);
  // A required form/booking SECTION and the form/booking BLOCK are the
  // same surface — merge the block's fields into the section shell so
  // the skeleton carries exactly one form, fully fielded.
  for (const sec of sections) {
    const kind = String(sec.kind).toLowerCase();
    if (kind !== "form" && kind !== "booking") continue;
    const block = pack.requiredBlocks.find(
      (b) => b.block === kind || (kind === "form" && b.block === "form") || (kind === "booking" && b.block === "booking"),
    );
    if (block?.fields?.length) {
      sec.formKind = block.formKind ?? sec.formKind;
      sec.fields = block.fields.map((name) => ({ name, label: name, type: "text" }));
      sec.button = sec.button ?? (kind === "booking" ? "Request this time" : "Send request");
    }
  }
  const covered = (kind: string) => sections.some((s) => String(s.kind).toLowerCase() === kind);
  for (const block of pack.requiredBlocks) {
    const sec = skeletonBlockSection(block, pack);
    if (!sec) continue;
    const kind = String(sec.kind).toLowerCase();
    if (!covered(kind)) sections.push(sec);
  }
  // Footer, when required, stays last.
  const footerIdx = sections.findIndex((s) => String(s.kind).toLowerCase() === "footer");
  if (footerIdx >= 0 && footerIdx !== sections.length - 1) {
    const [f] = sections.splice(footerIdx, 1);
    sections.push(f);
  }
  // Gallery skeletons carry the pack's required subjects so the fill
  // starts on-topic.
  for (const sec of sections) {
    if (String(sec.kind).toLowerCase() === "gallery" && (sec.images ?? []).length === 0) {
      sec.images = [...pack.images.required];
    }
  }
  return {
    title: "{Business}",
    description: "",
    seoTitle: pack.seo.titlePattern,
    theme: pack.themeDefaults.theme,
    accentHue: pack.themeDefaults.accentHue,
    hero: {
      kind: "hero",
      heading: "",
      subheading: "",
      cta: pack.hero.cta,
      image: pack.hero.imageSubjects[0],
    },
    sections,
  };
}

// ─── Brief (§4.3.1) ──────────────────────────────────────────────────

export function buildPackBrief(pack: TopicPack): string {
  const lines: string[] = [];
  lines.push(`## Topic pack: ${pack.label} (${pack.id})`);
  lines.push(pack.summary);
  lines.push(
    `Build this site with ONE site.compose call whose plan satisfies the ${pack.id} pack, and pass "pack": "${pack.id}" in the call. ` +
      `Theme default: ${pack.themeDefaults.theme}, accentHue ${pack.themeDefaults.accentHue} (override only if the user asked).`,
  );
  lines.push(`Hero: image subject MUST be one of: ${pack.hero.imageSubjects.join(" | ")}. Primary call to action: "${pack.hero.cta}".`);
  if (pack.hero.requiredElements.length) {
    lines.push(`Hero must carry: ${pack.hero.requiredElements.join("; ")}.`);
  }
  lines.push("Required sections, in this order:");
  for (const req of pack.requiredSections) {
    const min = req.minItems ? ` — at least ${req.minItems} items` : "";
    const fields = req.requiredFields?.length ? ` — every item needs: ${req.requiredFields.join(", ")}` : "";
    lines.push(`- ${req.kind} (${req.label})${min}${fields}: ${req.notes}`);
  }
  if (pack.optionalSections.length) {
    lines.push(`Optional when natural: ${pack.optionalSections.map((s) => `${s.kind} (${s.label})`).join(", ")}.`);
  }
  for (const block of pack.requiredBlocks) {
    const fields = block.fields?.length ? ` Fields: ${block.fields.join(", ")}.` : "";
    const fk = block.formKind ? ` Form kind: ${block.formKind}.` : "";
    lines.push(`Required block — ${block.block}: ${block.notes}${fk}${fields}`);
  }
  lines.push(
    `Images: use ONLY these subjects — required: ${pack.images.required.join(" | ")}; also allowed: ${pack.images.allowed.join(" | ")}. ` +
      `Never: ${pack.images.banned.join(" | ")}.`,
  );
  lines.push(
    `Copy: tone — ${pack.copy.tone} The copy MUST mention: ${pack.copy.mustMention.join("; ")}. ` +
      `Never use: ${pack.copy.bannedPhrases.join("; ")}. No lorem ipsum, no placeholder text.`,
  );
  lines.push(
    `SEO: set seoTitle following "${pack.seo.titlePattern}" and description following "${pack.seo.descriptionPattern}" ` +
      `(weave in: ${pack.seo.localKeywords.join(", ")}).`,
  );
  lines.push(
    `Completeness floor: at least ${pack.completeness.minSections} sections, gallery at least ${pack.completeness.galleryMinImages} images` +
      (pack.completeness.testimonialsMin ? `, at least ${pack.completeness.testimonialsMin} testimonials` : "") +
      `. A plan that misses a requirement is rejected with the exact missing pieces — fix and re-emit.`,
  );
  lines.push(`Start from this skeleton and fill every shell with real copy for the user's business:`);
  lines.push("```json");
  lines.push(JSON.stringify(buildSkeletonPlan(pack)));
  lines.push("```");
  return lines.join("\n");
}

// ─── Presence checklist (§4.6.4, Next.js checklist mode) ─────────────

const BLOCK_MARKERS: Record<string, (content: string) => boolean> = {
  form: (c) => c.includes("<form"),
  booking: (c) => c.includes("<form") && (c.includes("date") || c.includes("time")),
  map: (c) => c.includes("service area") || c.includes("areas we serve"),
  gallery: (c) => c.includes("<img") || c.includes("gallery"),
  payments: (c) => /\$\s?\d/.test(c),
  hours: (c) => c.includes("monday") || c.includes("hours"),
  reviews: (c) => c.includes("review") || c.includes("testimonial"),
};

const SECTION_MARKERS: Record<string, (content: string) => boolean> = {
  form: BLOCK_MARKERS.form,
  booking: BLOCK_MARKERS.booking,
  areas: BLOCK_MARKERS.map,
  gallery: BLOCK_MARKERS.gallery,
  hours: BLOCK_MARKERS.hours,
  testimonials: BLOCK_MARKERS.reviews,
  pricing: BLOCK_MARKERS.payments,
  faq: (c) => c.includes("faq") || c.includes("<details") || c.includes("frequently asked"),
  process: (c) => c.includes("process") || c.includes("how it works"),
  footer: (c) => c.includes("<footer"),
  contact: (c) => c.includes("contact"),
};

export interface PackPresenceResult {
  present: string[];
  missing: string[];
}

/**
 * Checklist-mode presence scan: for every required section and block,
 * look for its heading hints or structural markers in the files the
 * run produced. Reports gaps — never fails anything.
 */
export function checkPackPresence(
  pack: TopicPack,
  files: Array<{ path: string; content: string }>,
): PackPresenceResult {
  const corpus = normText(files.map((f) => f.content).join("\n"));
  const raw = files.map((f) => f.content).join("\n").toLowerCase();
  const present: string[] = [];
  const missing: string[] = [];

  for (const req of pack.requiredSections) {
    const kinds = [req.kind, ...(req.altKinds ?? [])];
    const hintHit = req.headingHints.some((h) => corpus.includes(normText(h)));
    const markerHit = kinds.some((k) => SECTION_MARKERS[k]?.(raw) ?? false);
    const labelHit = corpus.includes(normText(req.label));
    const label = `section "${req.kind}" (${req.label})`;
    if (hintHit || markerHit || labelHit) present.push(label);
    else missing.push(label);
  }
  for (const block of pack.requiredBlocks) {
    const marker = BLOCK_MARKERS[block.block];
    const label = `block "${block.block}"`;
    if (marker && marker(raw)) present.push(label);
    else if (!present.some((p) => p.includes(`"${block.block}"`))) missing.push(label);
  }
  return { present, missing };
}
