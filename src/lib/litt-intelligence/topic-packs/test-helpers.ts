/**
 * Test helper: build a complete, pack-valid plan for any pack by
 * filling its skeleton with sample copy. This is the self-consistency
 * proof for every pack: a plan built exactly to the pack's own brief
 * (skeleton + required facts + required subjects) must pass the
 * pack's own validator.
 */
import { buildSkeletonPlan } from "./pack-brief";
import type { TopicPack } from "./types";

// Raw plans are untyped JSON by design; the pack validators, not static
// types, are what check these shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawSection = Record<string, any>;

function fillItem(kind: string, item: RawSection): RawSection {
  const out: RawSection = { ...item };
  for (const k of Object.keys(out)) {
    if (typeof out[k] === "string" && !out[k].trim()) out[k] = `Sample ${k}`;
  }
  if (kind === "testimonials") {
    out.quote = out.quote || "They did great work and left everything clean.";
    out.author = out.author || "Jamie R., Grand Haven";
  } else if (kind === "faq") {
    out.question = out.question || "How does it work?";
    out.answer = out.answer || "Here is the honest answer with real detail.";
  } else if (kind === "hours") {
    out.day = out.day || "Monday";
    out.hours = out.hours || "9 AM – 5 PM";
  } else if (["features", "services", "cards", "menu", "process", "stats", "contact"].includes(kind)) {
    out.title = out.title || "Sample title";
    out.text = out.text || "Sample description with real detail.";
    if (kind === "menu") {
      out.price = out.price || "$12";
    }
    if (kind === "stats") {
      out.value = out.value || "10+";
      out.label = out.label || "Years";
    }
    if (kind === "contact") {
      out.label = out.label || "Phone";
      out.value = out.value || "(555) 010-0100";
    }
  }
  return out;
}

export function buildCompletePlan(pack: TopicPack): RawSection {
  const skel = buildSkeletonPlan(pack) as unknown as RawSection;
  const plan: RawSection = {
    ...skel,
    title: "Test Business",
    description: pack.seo.descriptionPattern
      .replaceAll("{Business}", "Test Business")
      .replaceAll("{City}", "Grand Haven")
      .replaceAll("{State}", "MI"),
    seoTitle: pack.seo.titlePattern
      .replaceAll("{Business}", "Test Business")
      .replaceAll("{City}", "Grand Haven")
      .replaceAll("{State}", "MI"),
    hero: {
      heading: `${pack.label} in Grand Haven`,
      subheading: `${pack.copy.mustMention.join(" · ")} — ${pack.summary}`,
      cta: pack.hero.cta,
      image: pack.hero.imageSubjects[0],
    },
  };
  plan.sections = (skel.sections as RawSection[]).map((sec) => {
    const out: RawSection = { ...sec };
    const kind = String(out.kind);
    if (Array.isArray(out.items)) {
      out.items = out.items.map((it: RawSection) => fillItem(kind, it));
    }
    if (kind === "areas" && (!Array.isArray(out.items) || out.items.length === 0)) {
      out.items = [{ town: "Grand Haven" }, { town: "Spring Lake" }];
      out.text = "Serving Grand Haven and the surrounding area.";
    }
    if (kind === "gallery") {
      const imgs = [...pack.images.required];
      let i = 0;
      while (imgs.length < pack.completeness.galleryMinImages && i < pack.images.allowed.length) {
        imgs.push(pack.images.allowed[i++]);
      }
      out.images = imgs.slice(0, 8);
    }
    if (kind === "pricing") {
      out.plans = (Array.isArray(out.plans) && out.plans.length ? out.plans : [{ name: "", price: "", features: [] }]).map(
        (p: RawSection) => ({ name: p.name || "Standard", price: p.price || "$49", features: p.features?.length ? p.features : ["Included item"] }),
      );
    }
    if (kind === "about" || kind === "text" || kind === "prose") {
      out.text = `${pack.copy.mustMention.join(". ")}. ${pack.summary} ${out.text ?? ""}`.trim();
    }
    if (kind === "form" || kind === "booking") {
      out.fields = ((out.fields ?? []) as Array<RawSection>).map((f) => {
        const name = String(f.name);
        const filled: RawSection = { ...f, label: f.label || name };
        if (/email/i.test(name)) filled.type = "email";
        else if (/phone|tel/i.test(name)) filled.type = "tel";
        else if (/message|notes|details/i.test(name)) filled.type = "textarea";
        else if (/date/i.test(name)) filled.type = "date";
        else if (/service|type|reason|topic/i.test(name)) {
          filled.type = "select";
          filled.options = ["Option one", "Option two"];
        } else filled.type = "text";
        return filled;
      });
      out.button = out.button || "Send request";
    }
    if (kind === "footer") {
      out.text = out.text || "Test Business — serving the local area.";
    }
    return out;
  });
  return plan;
}
