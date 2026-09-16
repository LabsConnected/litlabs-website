/**
 * fabrication-guard — pre-publish honesty check.
 *
 * Starter templates used to ship fabricated social proof (invented
 * testimonials, a fake client logo cloud, invented pricing) and LiTT
 * marketing copy as default page content. The templates now ship empty
 * slots instead, but sites built from the OLD templates may still carry
 * the fabricated text. This module detects that unedited content so the
 * publish pipeline can block it with a clear, non-technical message
 * naming the section to fix.
 *
 * Pure: no I/O, no app imports. Safe to use on server or client.
 */

export interface FabricationCheckFile {
  path: string;
  content: string;
}

export interface FabricationViolation {
  /** Human section label, e.g. "Testimonials" — names what the user must fix. */
  section: string;
  /** Non-technical, user-facing message naming the section to fix. */
  message: string;
  /** File the fabricated text was found in. */
  file: string;
  /** Short excerpt of the matched text (<= 140 chars). */
  matched: string;
}

export interface FabricationCheckResult {
  ok: boolean;
  violations: FabricationViolation[];
}

/**
 * Text-bearing extensions we scan. Binaries (images, fonts, zips) are
 * skipped so minified data can't trip the guard.
 */
const SCANNABLE_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".js",
  ".css",
  ".xml",
  ".svg",
  ".rss",
  ".webmanifest",
]);

function isScannable(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return SCANNABLE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * Fingerprints of the pre-purge starter templates. Kept here even though
 * the templates themselves no longer ship this content — they are what
 * lets us detect sites built from the old defaults.
 */
const FABRICATED_TESTIMONIAL_NAMES = ["Sarah Chen", "Marcus Reid", "Aisha Patel"];

/** { section, phrase } pairs: LiTT-marketing / placeholder copy shipped as defaults. */
const FABRICATED_COPY: { section: string; phrase: string }[] = [
  { section: "Hero section", phrase: "Build Something Amazing" },
  { section: "Hero section", phrase: "Your vision, powered by LiTTree" },
  { section: "Hero section", phrase: "Launch Faster with LiTT" },
  {
    section: "Hero section",
    phrase: "The AI-native builder that turns ideas into production-ready apps.",
  },
  { section: "Call to action", phrase: "Ready to Build Something Great?" },
  { section: "Call to action", phrase: "Join thousands of builders using LiTTree" },
];

const FAKE_LOGO_HEADING = "Trusted by teams at";
const FAKE_LOGO_NAMES = ["Acme", "Globex", "Initech", "Umbrella", "Hooli"];

const FAKE_PRICING_PLAN_NAMES = ["Starter", "Pro", "Enterprise"];
const FAKE_PRICING_PRICES = ["$0", "$29", "$99"];
const FAKE_PRICING_DESCRIPTIONS = [
  "Perfect for trying out",
  "For growing projects",
  "Unlimited everything",
];

function countMatches(haystack: string, needles: string[]): number {
  return needles.filter((n) => haystack.includes(n.toLowerCase())).length;
}

/** Short excerpt around the first occurrence of `needle` in `content`. */
function excerpt(content: string, needle: string, radius = 40): string {
  const idx = content.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return needle.slice(0, 140);
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + needle.length + radius);
  const raw = (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
  return raw.length > 140 ? raw.slice(0, 137) + "…" : raw;
}

/**
 * Scan published files for unedited fabricated-proof sections.
 *
 * Returns `{ ok: true }` when nothing fabricated is found, otherwise one
 * violation per offending section per file, each with a non-technical
 * message naming the section to fix.
 */
export function validateNoFabricatedContent(input: {
  files: FabricationCheckFile[];
}): FabricationCheckResult {
  const violations: FabricationViolation[] = [];
  const seen = new Set<string>();

  const add = (section: string, message: string, file: string, matched: string) => {
    const key = `${section}::${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ section, message, file, matched });
  };

  for (const file of input.files ?? []) {
    if (!file || !isScannable(file.path)) continue;
    const content = file.content ?? "";
    if (!content) continue;
    const haystack = content.toLowerCase();

    // 1. Invented testimonial names.
    for (const name of FABRICATED_TESTIMONIAL_NAMES) {
      if (haystack.includes(name.toLowerCase())) {
        add(
          "Testimonials",
          `Your Testimonials section still shows the template's example review ("${name}"). ` +
            `Replace it with a real review from one of your own customers before publishing.`,
          file.path,
          excerpt(content, name),
        );
      }
    }

    // 2. LiTT-marketing / placeholder hero & CTA copy.
    for (const { section, phrase } of FABRICATED_COPY) {
      if (haystack.includes(phrase.toLowerCase())) {
        add(
          section,
          `Your ${section} still says "${phrase}". ` +
            `Write your own words about your business before publishing.`,
          file.path,
          excerpt(content, phrase),
        );
      }
    }

    // 3. Fake logo cloud: the "trusted by" heading plus at least two of the
    //    fake company names, or at least four of the names together.
    const logoHits = countMatches(haystack, FAKE_LOGO_NAMES);
    const hasLogoHeading = haystack.includes(FAKE_LOGO_HEADING.toLowerCase());
    if ((hasLogoHeading && logoHits >= 2) || logoHits >= 4) {
      add(
        "Logo cloud",
        `Your logo cloud still lists the template's example companies (${FAKE_LOGO_NAMES.slice(0, 3).join(", ")}, …). ` +
          `Replace them with businesses you actually work with before publishing.`,
        file.path,
        excerpt(content, hasLogoHeading ? FAKE_LOGO_HEADING : FAKE_LOGO_NAMES.find((n) => haystack.includes(n.toLowerCase())) ?? ""),
      );
    }

    // 4. Invented pricing table: all three plan names with at least two of
    //    the fake prices, or at least two of the fake plan descriptions.
    const planNameHits = countMatches(haystack, FAKE_PRICING_PLAN_NAMES);
    const priceHits = countMatches(haystack, FAKE_PRICING_PRICES);
    const descHits = countMatches(haystack, FAKE_PRICING_DESCRIPTIONS);
    if ((planNameHits === FAKE_PRICING_PLAN_NAMES.length && priceHits >= 2) || descHits >= 2) {
      add(
        "Pricing",
        `Your pricing section still shows the template's example plans and prices ($0/$29/$99). ` +
          `Set your own plan names and prices before publishing.`,
        file.path,
        excerpt(content, FAKE_PRICING_DESCRIPTIONS.find((d) => haystack.includes(d.toLowerCase())) ?? "$29"),
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
