/**
 * Roofing vertical preset — the first "idea into an operating business" slice.
 *
 * This module is the intake preset for a roofing company: it detects a
 * roofing business from a free-text description, builds an honest starter
 * site from the `roofing-site` template, and maps the owner's real facts
 * (name, phone, service area, services) into it. Anything the owner did
 * not provide stays a clearly-empty slot — never fabricated.
 *
 * Pure: no I/O, no app imports beyond the canvas builder types. Safe for
 * server routes, client components, and tests.
 */

import {
  buildIntakeProfile,
  inferBusinessType,
  type BusinessProfile,
  type BusinessTypeInference,
} from "@/lib/business-profile";
import {
  buildStarterPage,
  STARTER_BUILDS,
} from "@/app/(app)/studio/components/canvas/builder/starter-builds";
import type {
  CanvasDocument,
  CanvasNode,
} from "@/app/(app)/studio/components/canvas/builder/types";

export const ROOFING_VERTICAL_ID = "roofing" as const;
export const ROOFING_TEMPLATE_ID = "roofing-site";

export interface RoofingIntakeField {
  key: "businessName" | "phone" | "serviceArea" | "services";
  label: string;
  required: boolean;
  placeholder: string;
}

export interface RoofingVertical {
  id: typeof ROOFING_VERTICAL_ID;
  label: string;
  /** BusinessTypeId this vertical belongs to. */
  businessType: "local-service";
  templateId: typeof ROOFING_TEMPLATE_ID;
  /** Keywords that identify a roofing business (case-insensitive substrings). */
  keywords: string[];
  /** The minimum the owner must provide; everything else stays an empty slot. */
  intakeFields: RoofingIntakeField[];
}

export const ROOFING_VERTICAL: RoofingVertical = {
  id: ROOFING_VERTICAL_ID,
  label: "Roofing company",
  businessType: "local-service",
  templateId: ROOFING_TEMPLATE_ID,
  keywords: [
    "roofing",
    "roofer",
    "roof replacement",
    "roof repair",
    "new roof",
    "re-roof",
    "reroof",
    "metal roofing",
    "shingle",
    "standing seam",
    "flat roof",
    "roof leak",
    "gutter installation",
  ],
  intakeFields: [
    { key: "businessName", label: "Business name", required: true, placeholder: "e.g. Apex Roofing Co." },
    { key: "phone", label: "Phone number", required: true, placeholder: "(555) 123-4567" },
    { key: "serviceArea", label: "Service area", required: false, placeholder: "e.g. Muskegon County, MI" },
    { key: "services", label: "Services you offer", required: false, placeholder: "e.g. Roof replacement, repairs, gutters" },
  ],
};

export interface RoofingDetection {
  isRoofing: boolean;
  matchedKeywords: string[];
  typeInference: BusinessTypeInference;
}

/**
 * Detect whether a free-text description is a roofing business.
 * Requires both roofing keywords AND a local-service type inference so
 * "roofing software" doesn't misfire into this vertical.
 */
export function detectRoofingVertical(description: string): RoofingDetection {
  const typeInference = inferBusinessType(description ?? "");
  const text = (description ?? "").toLowerCase();
  const matchedKeywords = ROOFING_VERTICAL.keywords.filter((kw) => text.includes(kw));
  return {
    isRoofing: matchedKeywords.length > 0 && typeInference.businessType === "local-service",
    matchedKeywords,
    typeInference,
  };
}

export interface RoofingIntake {
  profile: BusinessProfile;
  detection: RoofingDetection;
}

/**
 * "Describe once" for the roofing vertical: extract the profile from the
 * description, run type inference, and point the recommendation at the
 * roofing template when this is a roofing business.
 */
export function intakeRoofingBusiness(description: string): RoofingIntake {
  const detection = detectRoofingVertical(description);
  const { profile } = buildIntakeProfile(description ?? "");
  if (detection.isRoofing) {
    profile.recommendedTemplateId = ROOFING_VERTICAL.templateId;
  }
  return { profile: { ...profile, updatedAt: new Date().toISOString() }, detection };
}

// ─── Profile → template mapping ─────────────────────────────────────

/** Profile facts the roofing template can display. `serviceArea` maps from `location`. */
type ProfileToken = "businessName" | "phone" | "email" | "serviceArea";

const TOKEN_RE = /\{\{(businessName|phone|email|serviceArea)\}\}/g;

const EMPTY_SLOT_LABELS: Record<ProfileToken, string> = {
  businessName: "[Your business name]",
  phone: "[Your phone number]",
  email: "[Your email]",
  serviceArea: "[Your service area]",
};

function profileTokenValue(profile: BusinessProfile, token: ProfileToken): string {
  switch (token) {
    case "businessName":
      return profile.businessName ?? "";
    case "phone":
      return profile.phone ?? "";
    case "email":
      return profile.email ?? "";
    case "serviceArea":
      return profile.location ?? "";
  }
}

function fillTokens(text: string, profile: BusinessProfile): string {
  return text.replace(TOKEN_RE, (_m, token: string) => {
    const t = token as ProfileToken;
    return profileTokenValue(profile, t) || EMPTY_SLOT_LABELS[t];
  });
}

/** Text-bearing props we scan for {{tokens}}. */
const TOKEN_PROPS = ["text", "placeholder", "label", "alt", "href"] as const;

function fillNodeTokens(node: CanvasNode, profile: BusinessProfile): CanvasNode {
  const props = { ...(node.props as Record<string, unknown>) };
  let changed = false;
  for (const key of TOKEN_PROPS) {
    const value = props[key];
    if (typeof value === "string" && value.includes("{{")) {
      const filled = fillTokens(value, profile);
      if (filled !== value) {
        props[key] = filled;
        changed = true;
      }
    }
  }
  return changed ? { ...node, props: props as CanvasNode["props"] } : node;
}

/**
 * Map the owner's real services onto the roofing services section.
 * Service cards are tagged with `metadata.roofingServiceSlot = index`
 * when the template is built; each provided service replaces the
 * example card title, and the card description becomes an honest
 * "describe this service" prompt instead of example copy.
 */
function mapServicesToSlots(
  nodes: Record<string, CanvasNode>,
  profile: BusinessProfile,
): Record<string, CanvasNode> {
  const services = (profile.services ?? []).filter((s) => s.trim().length > 0);
  if (services.length === 0) return nodes;
  const out = { ...nodes };
  for (const node of Object.values(out)) {
    const slot = node.metadata?.roofingServiceSlot;
    if (typeof slot !== "number" || slot >= services.length) continue;
    const service = services[slot]!.trim();
    const headingId = node.children?.[0];
    const descId = node.children?.[1];
    if (headingId && out[headingId]) {
      const heading = out[headingId]!;
      out[headingId] = {
        ...heading,
        props: { ...heading.props, text: service },
      };
    }
    if (descId && out[descId]) {
      const desc = out[descId]!;
      out[descId] = {
        ...desc,
        props: { ...desc.props, text: "Describe this service — what you do, materials, warranty." },
      };
    }
  }
  return out;
}

/**
 * Apply a business profile to a built roofing document: replace
 * {{tokens}} with the owner's real facts (or clearly-empty labels),
 * and map real services onto the service cards.
 */
export function applyRoofingProfileToDocument(
  doc: CanvasDocument,
  profile: BusinessProfile,
): CanvasDocument {
  const filled: Record<string, CanvasNode> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    filled[id] = fillNodeTokens(node, profile);
  }
  return { ...doc, nodes: mapServicesToSlots(filled, profile) };
}

/**
 * Build the complete roofing starter site for a profile: instantiate
 * the `roofing-site` template and map the profile's real facts into it.
 */
export function buildRoofingSite(profile: BusinessProfile): CanvasDocument {
  const build = STARTER_BUILDS.find((b) => b.id === ROOFING_VERTICAL.templateId);
  if (!build) {
    throw new Error(`Roofing template "${ROOFING_VERTICAL.templateId}" is not registered`);
  }
  return applyRoofingProfileToDocument(buildStarterPage(build), profile);
}
