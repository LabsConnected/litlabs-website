import { describe, it, expect } from "vitest";
import { validateSitePlan } from "../site-compose";
import { ALL_PACKS } from "./index";
import { buildCompletePlan } from "./test-helpers";

/**
 * Parameterized pack-validator tests (spec §5): for EVERY pack, a
 * complete plan passes; a plan missing each required section in turn
 * fails with that pack's error; a banned image subject fails; an
 * under-minItems plan fails.
 */

describe("pack validation — every pack", () => {
  for (const pack of ALL_PACKS) {
    describe(`pack: ${pack.id}`, () => {
      it("accepts a complete plan built to its own brief", () => {
        const v = validateSitePlan(buildCompletePlan(pack), { pack });
        expect(v.errors, v.errors.join(" | ")).toEqual([]);
        expect(v.ok).toBe(true);
      });

      it("rejects the plan when each required section is removed in turn", () => {
        const complete = buildCompletePlan(pack);
        // Map required-section reqs to section indices by consuming
        // kinds in order, mirroring the validator's matching.
        const usedIdx = new Set<number>();
        const sectionIdxForReq: Array<number | null> = pack.requiredSections.map((req) => {
          const kinds = [req.kind, ...(req.altKinds ?? [])];
          for (const kind of kinds) {
            const idx = (complete.sections as Array<Record<string, any>>).findIndex(
              (s, i) => String(s.kind) === kind && !usedIdx.has(i),
            );
            if (idx >= 0) {
              usedIdx.add(idx);
              return idx;
            }
          }
          return null;
        });

        pack.requiredSections.forEach((req, i) => {
          const idx = sectionIdxForReq[i];
          // A req satisfied by a block section appended after the
          // required sections (e.g. a form) still maps to a real index;
          // if it does not, the complete-plan test above already fails.
          expect(idx, `${pack.id}: no section found for req "${req.kind}"`).not.toBeNull();
          const plan = buildCompletePlan(pack);
          plan.sections.splice(idx!, 1);
          const v = validateSitePlan(plan, { pack });
          expect(v.ok, `${pack.id}: removing "${req.kind}" (${req.label}) should fail`).toBe(false);
          expect(
            v.errors.some((e) => e.includes(pack.id)),
            `${pack.id}: errors should name the pack — got: ${v.errors.join(" | ")}`,
          ).toBe(true);
        });
      });

      it("rejects a banned image subject", () => {
        const plan = buildCompletePlan(pack);
        const gallery = (plan.sections as Array<Record<string, any>>).find((s) => s.kind === "gallery");
        if (gallery) {
          gallery.images = [pack.images.banned[0]];
        } else {
          // Gallery-less packs: poison the hero image instead — the
          // banned-subject rule covers every image slot on the page.
          (plan.hero as Record<string, any>).image = pack.images.banned[0];
        }
        const v = validateSitePlan(plan, { pack });
        expect(v.ok).toBe(false);
        expect(v.errors.join(" ")).toMatch(/banned|not in the .* allowed subjects/);
      });

      it("rejects an under-minimum section", () => {
        const req = pack.requiredSections.find((r) => (r.minItems ?? 0) >= 2);
        expect(req, `${pack.id}: needs a required section with minItems >= 2`).toBeDefined();
        const plan = buildCompletePlan(pack);
        const sec = (plan.sections as Array<Record<string, any>>).find(
          (s) => s.kind === req!.kind || (req!.altKinds ?? []).includes(s.kind),
        );
        expect(sec).toBeDefined();
        if (Array.isArray(sec!.items)) sec!.items = sec!.items.slice(0, req!.minItems! - 1);
        else if (Array.isArray(sec!.images)) sec!.images = sec!.images.slice(0, req!.minItems! - 1);
        else if (Array.isArray(sec!.fields)) sec!.fields = sec!.fields.slice(0, req!.minItems! - 1);
        const v = validateSitePlan(plan, { pack });
        expect(v.ok).toBe(false);
        expect(v.errors.join(" ")).toContain(pack.id);
      });

      it("rejects copy that drops a must-mention fact", () => {
        const fact = pack.copy.mustMention[0];
        expect(fact, `${pack.id}: needs at least one mustMention fact`).toBeDefined();
        const plan = buildCompletePlan(pack);
        const scrub = (o: unknown): unknown => {
          if (typeof o === "string") {
            return o.replace(new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "our team");
          }
          if (Array.isArray(o)) return o.map(scrub);
          if (o && typeof o === "object") {
            return Object.fromEntries(Object.entries(o).map(([k, val]) => [k, scrub(val)]));
          }
          return o;
        };
        const scrubbed = scrub(plan) as Record<string, any>;
        const v = validateSitePlan(scrubbed, { pack });
        expect(v.ok).toBe(false);
        expect(v.errors.join(" ")).toContain("never mentions");
      });
    });
  }
});

describe("pack validation — the §3 roofing example", () => {
  const roofing = ALL_PACKS.find((p) => p.id === "roofing")!;

  it("fails the thin hero+services+gallery+footer plan with named gaps", () => {
    const thin = {
      title: "Grand Haven Roofing",
      description: "A roofing company in Grand Haven, Michigan for roof replacement and repair.",
      seoTitle: "Grand Haven Roofing — Roofing Contractor in Grand Haven, MI",
      hero: { heading: "Roofing done right", subheading: "Licensed and insured", cta: "Get a free roof inspection", image: "roofers installing asphalt shingles" },
      sections: [
        { kind: "services", heading: "Services", items: [
          { title: "Replacement", text: "Full tear-off and install" },
          { title: "Repair", text: "Leaks fixed" },
          { title: "Inspections", text: "Free inspections" },
        ] },
        { kind: "gallery", heading: "Work", images: ["roofers installing asphalt shingles", "completed house with new roof", "roofing crew working on residential roof", "shingle texture close-up"] },
        { kind: "footer", text: "Grand Haven Roofing" },
      ],
    };
    const v = validateSitePlan(thin, { pack: roofing });
    expect(v.ok).toBe(false);
    const joined = v.errors.join("\n");
    expect(joined).toContain('missing required section "process"');
    expect(joined).toContain('missing required block "form"');
    expect(joined).toContain("needs at least 5");
  });

  it("raises the section cap for pack plans (§4.5A) but not pack-free plans", () => {
    const plan = buildCompletePlan(roofing);
    expect(plan.sections.length).toBeGreaterThan(12);
    const withPack = validateSitePlan(plan, { pack: roofing });
    expect(withPack.ok).toBe(true);
    const withoutPack = validateSitePlan(plan);
    expect(withoutPack.ok).toBe(false);
    expect(withoutPack.errors.join(" ")).toMatch(/too many sections|exceeds 8000 bytes/);
  });
});
