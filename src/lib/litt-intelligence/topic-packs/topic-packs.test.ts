import { describe, it, expect } from "vitest";
import { KNOWN_KINDS } from "../site-compose";
import { ALL_PACKS, getPack, selectTopicPack, hasPackOptOut, checkPackPresence } from "./index";

/**
 * Schema test (spec §5): EVERY registered pack must itself be valid —
 * known kinds only, sane minimums, non-empty image lists, no required
 * block without a renderer path.
 */

const BLOCK_TO_KINDS: Record<string, string[]> = {
  form: ["form"],
  booking: ["booking", "form"],
  map: ["areas"],
  gallery: ["gallery"],
  payments: ["pricing"],
  hours: ["hours"],
  reviews: ["testimonials"],
};

describe("topic pack schema — every pack is valid", () => {
  it("registers exactly the 20 spec packs, uniquely", () => {
    expect(ALL_PACKS).toHaveLength(20);
    expect(new Set(ALL_PACKS.map((p) => p.id)).size).toBe(20);
  });

  for (const pack of ALL_PACKS) {
    describe(`pack: ${pack.id}`, () => {
      it("has the required identity fields", () => {
        expect(pack.id).toMatch(/^[a-z0-9-]+$/);
        expect(pack.label.length).toBeGreaterThan(2);
        expect(pack.version).toBeGreaterThanOrEqual(1);
        expect(pack.summary.length).toBeGreaterThan(20);
        expect(getPack(pack.id)).toBe(pack);
      });

      it("matches on real vocabulary", () => {
        expect(pack.match.keywords.length).toBeGreaterThanOrEqual(3);
        expect(pack.match.phrases.length).toBeGreaterThanOrEqual(2);
      });

      it("requires only section kinds the composer can render", () => {
        for (const req of [...pack.requiredSections, ...pack.optionalSections]) {
          expect(KNOWN_KINDS.has(req.kind), `${pack.id}: kind "${req.kind}"`).toBe(true);
          for (const alt of req.altKinds ?? []) {
            expect(KNOWN_KINDS.has(alt), `${pack.id}: altKind "${alt}"`).toBe(true);
          }
          expect(req.label.length).toBeGreaterThan(1);
          expect(req.notes.length).toBeGreaterThan(10);
          if (req.minItems !== undefined) {
            expect(req.minItems).toBeGreaterThanOrEqual(1);
            expect(req.minItems).toBeLessThanOrEqual(9);
          }
        }
      });

      it("requires only blocks with a renderer path", () => {
        for (const block of pack.requiredBlocks) {
          expect(BLOCK_TO_KINDS[block.block], `${pack.id}: block "${block.block}"`).toBeDefined();
          if (block.block === "form" || block.block === "booking") {
            expect((block.fields ?? []).length).toBeGreaterThanOrEqual(3);
          }
        }
      });

      it("has usable image lists", () => {
        expect(pack.images.required.length).toBeGreaterThanOrEqual(1);
        expect(pack.images.allowed.length).toBeGreaterThanOrEqual(3);
        expect(pack.images.banned.length).toBeGreaterThanOrEqual(2);
        expect(pack.hero.imageSubjects.length).toBeGreaterThanOrEqual(2);
        // The hero's first subject must be an allowed on-topic subject.
        expect(
          [...pack.images.required, ...pack.images.allowed].some(
            (s) => s.toLowerCase().includes(pack.hero.imageSubjects[0].split(" ")[0].toLowerCase()),
          ),
        ).toBe(true);
      });

      it("has sane completeness floors that fit the pack caps", () => {
        expect(pack.completeness.minSections).toBeGreaterThanOrEqual(4);
        expect(pack.completeness.minSections).toBeLessThanOrEqual(16);
        expect(pack.requiredSections.length).toBeLessThanOrEqual(16);
        expect(pack.completeness.galleryMinImages).toBeLessThanOrEqual(8);
        expect(pack.completeness.testimonialsMin).toBeLessThanOrEqual(6);
      });

      it("has SEO patterns with a business placeholder", () => {
        expect(pack.seo.titlePattern).toContain("{Business}");
        expect(pack.seo.descriptionPattern.length).toBeGreaterThan(30);
        expect(pack.seo.schemaType.length).toBeGreaterThan(2);
      });

      it("bans lorem-style filler in copy rules", () => {
        expect(pack.copy.tone.length).toBeGreaterThan(10);
        expect(pack.copy.bannedPhrases.length).toBeGreaterThanOrEqual(2);
      });
    });
  }
});

describe("selectTopicPack — deterministic selection", () => {
  it("selects roofing for a roofing company prompt", () => {
    const sel = selectTopicPack("Build a site for my roofing company in Grand Haven");
    expect(sel?.pack.id).toBe("roofing");
  });

  it("does NOT select roofing for a rooftop bar", () => {
    const sel = selectTopicPack("A website for a rooftop bar and cocktail lounge downtown");
    expect(sel?.pack.id).not.toBe("roofing");
  });

  it("returns null for an unmatched prompt (general fallback)", () => {
    expect(selectTopicPack("Make me a page about my vacation photos from last summer")).toBeNull();
  });

  it("honors the user's opt-out", () => {
    expect(hasPackOptOut("Build a roofing site, no pack please")).toBe(true);
    expect(selectTopicPack("Build a roofing company site — no pack, keep it simple")).toBeNull();
  });

  it("honors an explicit pack mention", () => {
    const sel = selectTopicPack("Use the roofing pack for this one");
    expect(sel?.pack.id).toBe("roofing");
    expect(sel?.via).toBe("explicit");
  });
});

describe("selectTopicPack — one golden prompt per pack (§5)", () => {
  const GOLDEN: Array<[string, string]> = [
    ["roofing", "Build a site for my roofing company in Grand Haven"],
    ["trades-home-services", "I need a website for my plumbing company — we do drain cleaning, water heaters, and emergency repairs"],
    ["restaurant-food", "Build a website for our family restaurant — Italian kitchen, wood fired pizza, open for dinner and brunch"],
    ["retail-ecommerce", "Create an online store for my handmade candle shop"],
    ["professional-services", "We need a website for our law firm handling family law and estate planning"],
    ["health-wellness", "Build a site for our dental clinic — cleanings, implants, and whitening, new patients welcome"],
    ["beauty-personal-care", "I run a hair salon and day spa — need a site with our service menu and booking"],
    ["real-estate", "Website for a real estate agent — homes for sale, featured listings, and a free valuation"],
    ["portfolio-creative", "I'm a wedding photographer and I need a portfolio site with galleries and packages"],
    ["saas-tech", "Landing page for our SaaS product — a dashboard tool that automates invoicing for freelancers"],
    ["blog-content", "Start a blog website for my podcast about Michigan history — episodes, topics, and a newsletter"],
    ["nonprofit-community", "Our food bank is a nonprofit organization and we need a website for donations and volunteers"],
    ["events-venues", "Build a website for our wedding venue — a banquet hall that hosts receptions and parties"],
    ["gaming-entertainment", "Make a site for our indie game studio — our first video game launches this fall"],
    ["automotive", "Website for our auto repair shop — brakes, oil changes, and tires, with online service booking"],
    ["education-courses", "I offer online courses and a coaching program for new managers — need a site with pricing and enrollment"],
    ["hospitality-travel", "We run a bed and breakfast and a few vacation rental cabins near the lake"],
    ["finance-insurance", "Site for our insurance agency — auto, home, and life insurance with a free quote review"],
    ["pets-animals", "Build a website for our dog grooming and pet boarding business"],
    ["personal-one-page", "Make me a personal website — a one-page resume with my links and a short bio"],
  ];

  it("covers every registered pack exactly once", () => {
    expect(GOLDEN.map(([id]) => id).sort()).toEqual(ALL_PACKS.map((p) => p.id).sort());
  });

  for (const [id, prompt] of GOLDEN) {
    it(`selects ${id} for its golden prompt`, () => {
      const sel = selectTopicPack(prompt);
      expect(sel?.pack.id, `prompt: ${prompt}`).toBe(id);
    });
  }
});

describe("checkPackPresence — Next.js checklist scan (§4.6.4)", () => {
  it("reports present and missing pieces from generated files", () => {
    const roofing = getPack("roofing")!;
    const files = [
      {
        path: "app/page.tsx",
        content:
          "<h1>Roofing in Grand Haven</h1><section>Our services</section>" +
          "<form action='/api/forms/submit'><input name='phone'/></form>" +
          "<p>Licensed and insured. Free inspection.</p>",
      },
    ];
    const result = checkPackPresence(roofing, files);
    expect(result.present.length).toBeGreaterThan(0);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing.join(" ")).toContain("faq");
  });

  it("finds nothing in empty files", () => {
    const roofing = getPack("roofing")!;
    const result = checkPackPresence(roofing, [{ path: "app/page.tsx", content: "" }]);
    expect(result.present).toHaveLength(0);
    expect(result.missing.length).toBeGreaterThan(5);
  });
});
