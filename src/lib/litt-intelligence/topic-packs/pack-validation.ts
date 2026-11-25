/**
 * Pack validation — the §1.2 completeness bar, machine-checked.
 *
 * Runs inside validateSitePlan (site-compose.ts) on the NORMALIZED
 * plan whenever a pack is attached, and returns actionable error
 * strings in the same format as structural errors — the model repairs
 * from them, and after the bounded repair attempts the run reports
 * the site as pack-incomplete with these exact missing pieces.
 *
 * Deterministic only: no model calls, no I/O. Every rule here is a
 * rule the brief states in the same words, so a plan built to the
 * brief passes by construction.
 */

import type { SitePlan, SitePlanSection } from "../site-compose";
import type { BlockReq, PackSectionReq, TopicPack } from "./types";

// ─── Text helpers ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "with", "and", "or", "on", "in", "at", "for",
  "to", "by", "our", "your", "their", "its", "from", "into", "over",
]);

export function normText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normText(value)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

/**
 * Does an image keyword express a pack subject? Token-overlap match:
 * every subject token present in the keyword, or ≥60% of the subject's
 * tokens (min 1) with the keyword not much longer than the subject.
 * "roofers installing shingles" matches the subject "roofers
 * installing asphalt shingles"; "office interior" does NOT match the
 * subject "restaurant interior" (only 1 of 2 tokens).
 */
export function subjectMatches(keyword: string, subject: string): boolean {
  const kt = tokenSet(keyword);
  const st = tokenSet(subject);
  if (st.size === 0 || kt.size === 0) return false;
  let inter = 0;
  for (const t of st) if (kt.has(t)) inter += 1;
  if (inter === st.size) return true;
  return inter >= Math.ceil(st.size * 0.6) && kt.size <= st.size + 2;
}

// ─── Plan introspection ──────────────────────────────────────────────

function kindOf(sec: SitePlanSection): string {
  return String(sec.kind ?? "").toLowerCase();
}

function sectionsOfKind(plan: SitePlan, kinds: string[]): SitePlanSection[] {
  const set = new Set(kinds);
  return plan.sections.filter((s) => set.has(kindOf(s)));
}

function itemCount(sec: SitePlanSection): number {
  const kind = kindOf(sec);
  if (kind === "gallery") return galleryImages(sec).length;
  if (kind === "pricing") return (sec.plans ?? sec.items ?? []).length;
  if (kind === "form" || kind === "booking") return (sec.fields ?? []).length;
  if (kind === "areas") return Math.max((sec.items ?? []).length, (sec.towns ?? []).length);
  return (sec.items ?? []).length;
}

function galleryImages(sec: SitePlanSection): string[] {
  const raw = sec.images ?? (sec.items ?? []);
  return (raw as unknown[]).map((img) => {
    if (typeof img === "string") return img;
    const o = img as Record<string, unknown>;
    return String(o?.keywords ?? o?.q ?? o?.image ?? "");
  }).filter(Boolean);
}

function collectImageKeywords(plan: SitePlan): string[] {
  const out: string[] = [];
  if (plan.hero?.image) out.push(String(plan.hero.image));
  for (const sec of plan.sections) {
    if (sec.image) out.push(String(sec.image));
    if (kindOf(sec) === "gallery") out.push(...galleryImages(sec));
  }
  return out;
}

function collectCopy(plan: SitePlan): string {
  const parts: string[] = [plan.title, plan.description ?? "", plan.seoTitle ?? ""];
  const pushSection = (sec: SitePlanSection | undefined) => {
    if (!sec) return;
    for (const k of ["heading", "subheading", "kicker", "text", "button", "cta"] as const) {
      if (sec[k]) parts.push(String(sec[k]));
    }
    for (const list of [sec.items, sec.plans, sec.links] as const) {
      for (const it of list ?? []) {
        for (const v of Object.values(it)) {
          if (typeof v === "string") parts.push(v);
          if (Array.isArray(v)) for (const x of v) if (typeof x === "string") parts.push(x);
        }
      }
    }
  };
  pushSection(plan.hero);
  for (const sec of plan.sections) pushSection(sec);
  return normText(parts.join(" \n "));
}

// ─── Section requirements ────────────────────────────────────────────

function checkSectionReq(
  plan: SitePlan,
  pack: TopicPack,
  req: PackSectionReq,
  errors: string[],
  used: Set<SitePlanSection>,
): void {
  // Requirements sharing a kind (roofing's three `features` rows)
  // consume DISTINCT sections in plan order; the primary kind is
  // preferred, then each altKind in turn.
  let sec: SitePlanSection | undefined;
  for (const kind of [req.kind, ...(req.altKinds ?? [])]) {
    sec = plan.sections.find((s) => kindOf(s) === kind && !used.has(s));
    if (sec) break;
  }
  if (!sec) {
    errors.push(`${pack.id} pack: missing required section "${req.kind}" (${req.label})`);
    return;
  }
  used.add(sec);
  if (req.minItems !== undefined) {
    const n = itemCount(sec);
    if (n < req.minItems) {
      errors.push(`${pack.id} pack: ${kindOf(sec)} has ${n} items, needs at least ${req.minItems} (${req.label})`);
    }
  }
  if (req.requiredFields?.length) {
    const items = (sec.items ?? sec.plans ?? []) as Array<Record<string, unknown>>;
    items.forEach((it, i) => {
      for (const f of req.requiredFields!) {
        if (!String(it[f] ?? "").trim()) {
          errors.push(`${pack.id} pack: ${kindOf(sec)} item ${i + 1} is missing "${f}" (${req.label})`);
        }
      }
    });
  }
}

// ─── Block requirements ──────────────────────────────────────────────

function formFieldNames(sec: SitePlanSection): Set<string> {
  return new Set(
    (sec.fields ?? []).map((f) => normText(f.name).replace(/ /g, "_")),
  );
}

function checkFormBlock(
  plan: SitePlan,
  pack: TopicPack,
  block: BlockReq,
  errors: string[],
  kinds: string[],
  label: string,
): void {
  const candidates = sectionsOfKind(plan, kinds).filter((sec) => {
    if (!block.formKind) return true;
    const fk = String(sec.formKind ?? "").toLowerCase();
    if (fk === block.formKind) return true;
    // A form section with no declared flavour renders as "contact" —
    // it satisfies a contact block, nothing more specific.
    return fk === "" && block.formKind === "contact";
  });
  const sec = candidates[0];
  if (!sec) {
    errors.push(
      `${pack.id} pack: missing required block "${block.block}" (${label}${block.formKind ? `, formKind "${block.formKind}"` : ""})`,
    );
    return;
  }
  for (const field of block.fields ?? []) {
    if (!formFieldNames(sec).has(normText(field).replace(/ /g, "_"))) {
      errors.push(`${pack.id} pack: the ${block.block} form is missing the "${field}" field`);
    }
  }
}

function checkBlock(plan: SitePlan, pack: TopicPack, block: BlockReq, errors: string[]): void {
  switch (block.block) {
    case "form":
      checkFormBlock(plan, pack, block, errors, ["form"], "form");
      return;
    case "booking":
      checkFormBlock(plan, pack, block, errors, ["booking", "form"], "booking");
      return;
    case "map": {
      const sec = sectionsOfKind(plan, ["areas"])[0];
      if (!sec || itemCount(sec) < 1) {
        errors.push(`${pack.id} pack: missing required block "map" (service-area / location block)`);
      }
      return;
    }
    case "gallery": {
      const total = sectionsOfKind(plan, ["gallery"]).reduce((n, s) => n + galleryImages(s).length, 0);
      const min = Math.max(1, pack.completeness.galleryMinImages);
      if (total < min) {
        errors.push(`${pack.id} pack: gallery has ${total} images, needs at least ${min} (block "gallery")`);
      }
      return;
    }
    case "payments": {
      const pricing = sectionsOfKind(plan, ["pricing"])[0];
      const priced = pricing
        ? (pricing.plans ?? pricing.items ?? []).some((p) => String((p as Record<string, unknown>).price ?? "").trim())
        : false;
      if (!priced && sectionsOfKind(plan, ["cta"]).length === 0) {
        errors.push(
          `${pack.id} pack: missing required block "payments" (priced offers, or the pack's quote/contact call-to-action)`,
        );
      }
      return;
    }
    case "hours": {
      const hours = sectionsOfKind(plan, ["hours"])[0];
      const contact = sectionsOfKind(plan, ["contact"])[0];
      const contactHasHours = (contact?.items ?? []).some((it) =>
        /hour|open/i.test(String(it.label ?? it.title ?? "")),
      );
      if ((!hours || itemCount(hours) < 1) && !contactHasHours) {
        errors.push(`${pack.id} pack: missing required block "hours" (opening hours)`);
      }
      return;
    }
    case "reviews": {
      const total = sectionsOfKind(plan, ["testimonials"]).reduce((n, s) => n + (s.items ?? []).length, 0);
      const min = Math.max(1, pack.completeness.testimonialsMin);
      if (total < min) {
        errors.push(`${pack.id} pack: reviews has ${total} testimonials, needs at least ${min} (block "reviews")`);
      }
      return;
    }
  }
}

// ─── The full bar (§1.2) ─────────────────────────────────────────────

export function validatePlanAgainstPack(plan: SitePlan, pack: TopicPack): string[] {
  const errors: string[] = [];
  const copy = collectCopy(plan);

  // 1. Required sections (distinct-section matching, in pack order).
  const used = new Set<SitePlanSection>();
  for (const req of pack.requiredSections) checkSectionReq(plan, pack, req, errors, used);

  // 2. Required blocks.
  for (const block of pack.requiredBlocks) checkBlock(plan, pack, block, errors);

  // 3. Hero: on-subject image + machine-checkable required elements.
  const heroImage = plan.hero?.image ? String(plan.hero.image) : "";
  if (!heroImage) {
    errors.push(`${pack.id} pack: hero needs an image — use one of the pack's hero subjects: ${pack.hero.imageSubjects.join("; ")}`);
  } else if (!pack.hero.imageSubjects.some((s) => subjectMatches(heroImage, s))) {
    errors.push(`${pack.id} pack: hero image "${heroImage}" is not one of the pack's hero subjects (${pack.hero.imageSubjects.join("; ")})`);
  }
  for (const el of pack.hero.requiredElements) {
    const m = /^trust line:\s*(.+)$/i.exec(el.trim());
    if (m && !copy.includes(normText(m[1]))) {
      errors.push(`${pack.id} pack: hero is missing its trust line — the copy never says "${m[1]}"`);
    }
  }

  // 4. Images: banned fails, off-list fails, required subjects appear.
  const keywords = collectImageKeywords(plan);
  const allowedSubjects = [...pack.images.required, ...pack.images.allowed];
  for (const kw of keywords) {
    const banned = pack.images.banned.find((b) => subjectMatches(kw, b));
    if (banned) {
      errors.push(`${pack.id} pack: image subject "${kw}" is banned for this topic (matches "${banned}")`);
    } else if (!allowedSubjects.some((s) => subjectMatches(kw, s))) {
      errors.push(`${pack.id} pack: image subject "${kw}" is not in the ${pack.id} allowed subjects`);
    }
  }
  for (const subject of pack.images.required) {
    if (!keywords.some((kw) => subjectMatches(kw, subject))) {
      errors.push(`${pack.id} pack: no image uses the required subject "${subject}"`);
    }
  }

  // 5. Copy rules.
  for (const fact of pack.copy.mustMention) {
    if (!copy.includes(normText(fact))) {
      errors.push(`${pack.id} pack: copy never mentions "${fact}"`);
    }
  }
  for (const phrase of pack.copy.bannedPhrases) {
    if (copy.includes(normText(phrase))) {
      errors.push(`${pack.id} pack: copy uses the banned phrase "${phrase}"`);
    }
  }
  if (/\blorem\b/.test(copy)) {
    errors.push(`${pack.id} pack: copy contains lorem ipsum placeholder text`);
  }

  // 6. SEO shape: title carries the pattern's topic literal; a real
  // meta description exists.
  const titleText = normText(plan.seoTitle ?? plan.title);
  const literals = pack.seo.titlePattern
    .split(/\{[^}]+\}/)
    .map((s) => normText(s))
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length);
  if (literals.length && !titleText.includes(literals[0])) {
    errors.push(
      `${pack.id} pack: page title should follow "${pack.seo.titlePattern}" — it must include "${literals[0]}" (set seoTitle on the plan)`,
    );
  }
  if (!plan.description || plan.description.trim().length < 30) {
    errors.push(`${pack.id} pack: meta description is required — follow "${pack.seo.descriptionPattern}"`);
  }

  // 7. Completeness floors.
  if (plan.sections.length < pack.completeness.minSections) {
    errors.push(`${pack.id} pack: plan has ${plan.sections.length} sections, needs at least ${pack.completeness.minSections}`);
  }
  if (pack.completeness.galleryMinImages > 0) {
    const total = sectionsOfKind(plan, ["gallery"]).reduce((n, s) => n + galleryImages(s).length, 0);
    if (total < pack.completeness.galleryMinImages) {
      errors.push(`${pack.id} pack: gallery has ${total} images, needs at least ${pack.completeness.galleryMinImages}`);
    }
  }
  if (pack.completeness.testimonialsMin > 0) {
    const total = sectionsOfKind(plan, ["testimonials"]).reduce((n, s) => n + (s.items ?? []).length, 0);
    if (total < pack.completeness.testimonialsMin) {
      errors.push(`${pack.id} pack: testimonials has ${total} entries, needs at least ${pack.completeness.testimonialsMin}`);
    }
  }

  // Order floor: the footer, when present as a section, comes last.
  const footerIdx = plan.sections.findIndex((s) => kindOf(s) === "footer");
  if (footerIdx >= 0 && footerIdx !== plan.sections.length - 1) {
    errors.push(`${pack.id} pack: the footer section must be last`);
  }

  return errors;
}
