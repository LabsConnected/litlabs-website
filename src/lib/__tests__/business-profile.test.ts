import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── In-memory Supabase fake for the server module ────────────────

type FakeRow = {
  id: string;
  user_id: string;
  settings: Record<string, unknown> | null;
  updated_at: string;
};

let fakeRows: FakeRow[] = [];

function makeChain() {
  const filters: Array<{ col: string; val: unknown }> = [];
  let mode: "select" | "update" | null = null;
  let payload: Record<string, unknown> | null = null;
  let orderCol: string | null = null;
  let orderAsc = true;
  let limitN: number | null = null;

  const run = (): FakeRow[] => {
    let result = fakeRows.filter((r) =>
      filters.every((f) => (r as Record<string, unknown>)[f.col] === f.val),
    );
    if (mode === "update" && payload) {
      for (const r of result) Object.assign(r, payload);
    }
    if (orderCol) {
      result = [...result].sort((a, b) => {
        const cmp = String(
          (a as Record<string, unknown>)[orderCol!] ?? "",
        ).localeCompare(String((b as Record<string, unknown>)[orderCol!] ?? ""));
        return orderAsc ? cmp : -cmp;
      });
    }
    if (limitN != null) result = result.slice(0, limitN);
    return result;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, (...args: any[]) => any> = {
    select: () => {
      mode = mode ?? "select";
      return chain;
    },
    update: (p: Record<string, unknown>) => {
      mode = "update";
      payload = p;
      return chain;
    },
    eq: (c: string, v: unknown) => {
      filters.push({ col: c, val: v });
      return chain;
    },
    order: (c: string, o?: { ascending?: boolean }) => {
      orderCol = c;
      orderAsc = o?.ascending ?? true;
      return chain;
    },
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    // Make the builder thenable so `await chain` resolves like the real client.
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: () => makeChain() },
}));

import {
  inferBusinessType,
  extractBusinessProfile,
  buildIntakeProfile,
  validateBusinessProfile,
  isBusinessProfile,
  buildBusinessProfilePromptBlock,
  BUSINESS_TYPES,
} from "../business-profile";
import {
  getBusinessProfileForProject,
  saveBusinessProfileForProject,
  getDefaultBusinessProfile,
  getBusinessProfile,
} from "../business-profile-server";

// ─── Inference mapping ────────────────────────────────────────────

describe("inferBusinessType", () => {
  it("infers local-service from a dog-grooming description", () => {
    const r = inferBusinessType(
      "I run a dog-grooming salon in Muskegon — baths, haircuts, nail trims.",
    );
    expect(r.businessType).toBe("local-service");
    expect(r.info.label).toBe("Local service business");
    expect(r.info.templateId).toBe("business-site");
    expect(r.matchedKeywords).toContain("dog grooming");
    expect(r.confidence).not.toBe("low");
  });

  it("infers restaurant-food for a cafe", () => {
    const r = inferBusinessType("We opened a cozy cafe downtown serving brunch and espresso.");
    expect(r.businessType).toBe("restaurant-food");
    expect(r.matchedKeywords).toContain("cafe");
  });

  it("infers online-store for ecommerce wording", () => {
    const r = inferBusinessType("I sell handmade candles online through my Shopify store.");
    expect(r.businessType).toBe("online-store");
    expect(r.info.templateId).toBe("store");
  });

  it("infers portfolio-creator for a photographer", () => {
    const r = inferBusinessType("I'm a wedding photographer — here's my portfolio of recent shoots.");
    expect(r.businessType).toBe("portfolio-creator");
    expect(r.info.category).toBe("Creator");
  });

  it("infers saas-software for a startup dashboard", () => {
    const r = inferBusinessType("We're building a SaaS analytics dashboard for marketing teams.");
    expect(r.businessType).toBe("saas-software");
    expect(r.info.templateId).toBe("saas-dashboard");
  });

  it("infers agency-professional for a marketing agency", () => {
    const r = inferBusinessType("Boutique marketing agency helping local brands with SEO.");
    expect(r.businessType).toBe("agency-professional");
  });

  it("infers health-wellness for a dental clinic", () => {
    const r = inferBusinessType("Family dental clinic offering cleanings and orthodontics.");
    expect(r.businessType).toBe("health-wellness");
  });

  it("infers music-artist for a band", () => {
    const r = inferBusinessType("We're an indie band — new album out, tour dates this fall on Spotify.");
    expect(r.businessType).toBe("music-artist");
  });

  it("infers real-estate and prefers multi-word specificity", () => {
    const r = inferBusinessType("Realtor helping families buy homes — new listings every week.");
    expect(r.businessType).toBe("real-estate");
  });

  it("returns other with low confidence when nothing matches", () => {
    const r = inferBusinessType("Just exploring some ideas, not sure what I want yet.");
    expect(r.businessType).toBe("other");
    expect(r.confidence).toBe("low");
    expect(r.matchedKeywords).toEqual([]);
    expect(r.info).toBe(BUSINESS_TYPES.other);
  });

  it("handles empty input without throwing", () => {
    const r = inferBusinessType("   ");
    expect(r.businessType).toBe("other");
    expect(r.confidence).toBe("low");
  });

  it("is case-insensitive and exposes matched keywords for transparency", () => {
    const r = inferBusinessType("PLUMBING and HVAC contractor");
    expect(r.businessType).toBe("local-service");
    expect(r.matchedKeywords.length).toBeGreaterThan(0);
  });
});

// ─── Extraction ───────────────────────────────────────────────────

describe("extractBusinessProfile", () => {
  it("extracts a quoted business name", () => {
    const p = extractBusinessProfile(
      '"Paws & Claws" is a dog-grooming salon in Muskegon.',
    );
    expect(p.businessName).toBe("Paws & Claws");
    expect(p.location).toBe("Muskegon");
  });

  it("extracts a called/named business name", () => {
    const p = extractBusinessProfile(
      "I run a bakery called Golden Crust Bakery in Grand Rapids.",
    );
    expect(p.businessName).toBe("Golden Crust Bakery");
    expect(p.location).toBe("Grand Rapids");
  });

  it("extracts a leading name before the location", () => {
    const p = extractBusinessProfile("Lakeside Fitness in Holland offers personal training.");
    expect(p.businessName).toBe("Lakeside Fitness");
    expect(p.location).toBe("Holland");
  });

  it("does not mistake a sentence start for a name", () => {
    const p = extractBusinessProfile("I run a dog-grooming salon in Muskegon.");
    expect(p.businessName).toBeUndefined();
    expect(p.location).toBe("Muskegon");
  });

  it("extracts phone and email", () => {
    const p = extractBusinessProfile(
      "Call us at (231) 555-0147 or email hello@pawsandclaws.com for bookings.",
    );
    expect(p.phone).toBe("(231) 555-0147");
    expect(p.email).toBe("hello@pawsandclaws.com");
  });

  it("extracts services from an offering list", () => {
    const p = extractBusinessProfile(
      "We offer baths, haircuts, nail trims and teeth cleaning.",
    );
    expect(p.services).toEqual(["baths", "haircuts", "nail trims", "teeth cleaning"]);
  });

  it("keeps the verbatim description as source of truth", () => {
    const desc = "I run a dog-grooming salon in Muskegon.";
    const p = extractBusinessProfile(desc);
    expect(p.description).toBe(desc);
  });

  it("returns an empty object for blank input", () => {
    expect(extractBusinessProfile("")).toEqual({});
  });

  it("rejects location false positives", () => {
    const p = extractBusinessProfile("Results in minutes, no waiting in general.");
    expect(p.location).toBeUndefined();
  });
});

// ─── Intake builder ───────────────────────────────────────────────

describe("buildIntakeProfile", () => {
  it("combines extraction and inference with capture metadata", () => {
    const { profile, inference } = buildIntakeProfile(
      '"Paws & Claws" is a dog-grooming salon in Muskegon offering baths and haircuts.',
    );
    expect(profile.businessName).toBe("Paws & Claws");
    expect(profile.businessType).toBe("local-service");
    expect(profile.services).toEqual(["baths", "haircuts"]);
    expect(profile.typeConfirmed).toBe(false);
    expect(profile.capturedAt).toBeDefined();
    expect(profile.updatedAt).toBeDefined();
    expect(profile.matchedKeywords).toEqual(inference.matchedKeywords);
    expect(profile.recommendedTemplateId).toBe("business-site");
  });
});

// ─── Validation ───────────────────────────────────────────────────

describe("validateBusinessProfile", () => {
  it("accepts a well-formed profile", () => {
    const { profile, errors } = validateBusinessProfile({
      businessName: "Paws & Claws",
      description: "Dog grooming in Muskegon",
      businessType: "local-service",
      location: "Muskegon, MI",
      phone: "(231) 555-0147",
      email: "hello@paws.com",
      services: ["baths", "haircuts"],
    });
    expect(errors).toEqual([]);
    expect(profile.businessName).toBe("Paws & Claws");
    expect(profile.services).toEqual(["baths", "haircuts"]);
  });

  it("drops unknown fields", () => {
    const { profile, errors } = validateBusinessProfile({
      businessName: "Acme",
      isAdmin: true,
      password: "x",
    });
    expect(errors).toEqual([]);
    expect(profile).not.toHaveProperty("isAdmin");
    expect(profile).not.toHaveProperty("password");
    expect(profile.businessName).toBe("Acme");
  });

  it("truncates overlong strings", () => {
    const { profile } = validateBusinessProfile({ businessName: "x".repeat(500) });
    expect(profile.businessName?.length).toBe(120);
  });

  it("drops malformed email and phone with notes", () => {
    const { profile, errors } = validateBusinessProfile({
      email: "not-an-email",
      phone: "abc",
    });
    expect(profile.email).toBeUndefined();
    expect(profile.phone).toBeUndefined();
    expect(errors).toHaveLength(2);
  });

  it("rejects non-object input", () => {
    const { profile, errors } = validateBusinessProfile("nope");
    expect(profile).toEqual({});
    expect(errors).toHaveLength(1);
  });

  it("normalizes whitespace-only fields to absent", () => {
    const { profile } = validateBusinessProfile({ businessName: "   " });
    expect(profile.businessName).toBeUndefined();
  });

  it("caps the services list", () => {
    const { profile } = validateBusinessProfile({
      services: Array.from({ length: 50 }, (_, i) => `service ${i}`),
    });
    expect(profile.services).toHaveLength(20);
  });
});

describe("isBusinessProfile", () => {
  it("accepts a valid stored shape", () => {
    expect(isBusinessProfile({ businessName: "Acme" })).toBe(true);
    expect(isBusinessProfile({})).toBe(true);
  });

  it("rejects non-objects and wrong field types", () => {
    expect(isBusinessProfile(null)).toBe(false);
    expect(isBusinessProfile("x")).toBe(false);
    expect(isBusinessProfile({ businessName: 42 })).toBe(false);
    expect(isBusinessProfile({ services: "baths" })).toBe(false);
  });
});

// ─── Prompt block ─────────────────────────────────────────────────

describe("buildBusinessProfilePromptBlock", () => {
  it("returns null when there is nothing to say", () => {
    expect(buildBusinessProfilePromptBlock(null)).toBeNull();
    expect(buildBusinessProfilePromptBlock(undefined)).toBeNull();
    expect(buildBusinessProfilePromptBlock({})).toBeNull();
  });

  it("renders present fields and never fabricates missing ones", () => {
    const block = buildBusinessProfilePromptBlock({
      businessName: "Paws & Claws",
      businessType: "local-service",
      location: "Muskegon",
      services: ["baths"],
    });
    expect(block).toContain("Paws & Claws");
    expect(block).toContain("Local service business");
    expect(block).toContain("Muskegon");
    expect(block).toContain("baths");
    expect(block).not.toContain("Phone:");
    expect(block).not.toContain("Email:");
  });

  it("passes through user-corrected free-text types", () => {
    const block = buildBusinessProfilePromptBlock({ businessType: "Escape room" });
    expect(block).toContain("Escape room");
  });
});

// ─── Server CRUD (mocked Supabase) ────────────────────────────────

describe("business-profile-server", () => {
  beforeEach(() => {
    fakeRows = [
      {
        id: "proj-1",
        user_id: "user_1",
        settings: {
          businessProfile: { businessName: "Acme", businessType: "retail-store" },
          otherKey: "keep-me",
        },
        updated_at: "2026-09-16T07:00:00Z",
      },
      {
        id: "proj-2",
        user_id: "user_1",
        settings: { otherKey: "no-profile" },
        updated_at: "2026-09-16T08:00:00Z",
      },
      {
        id: "proj-3",
        user_id: "user_2",
        settings: { businessProfile: { businessName: "Other User Biz" } },
        updated_at: "2026-09-16T09:00:00Z",
      },
    ];
  });

  it("getBusinessProfileForProject returns the stored profile", async () => {
    const p = await getBusinessProfileForProject("proj-1", "user_1");
    expect(p?.businessName).toBe("Acme");
  });

  it("getBusinessProfileForProject returns null for foreign projects", async () => {
    expect(await getBusinessProfileForProject("proj-3", "user_1")).toBeNull();
    expect(await getBusinessProfileForProject("nope", "user_1")).toBeNull();
  });

  it("getBusinessProfileForProject returns null when no profile exists", async () => {
    expect(await getBusinessProfileForProject("proj-2", "user_1")).toBeNull();
  });

  it("saveBusinessProfileForProject writes and preserves other settings keys", async () => {
    const result = await saveBusinessProfileForProject("proj-2", "user_1", {
      businessName: "New Biz",
      businessType: "local-service",
      hacker: "dropped",
    });
    expect(result?.errors).toEqual([]);
    expect(result?.profile.businessName).toBe("New Biz");
    expect(result?.profile.updatedAt).toBeDefined();
    const row = fakeRows.find((r) => r.id === "proj-2")!;
    expect(row.settings!.otherKey).toBe("no-profile");
    expect(
      (row.settings!.businessProfile as Record<string, unknown>).businessName,
    ).toBe("New Biz");
    expect(row.settings!).not.toHaveProperty("hacker");
  });

  it("saveBusinessProfileForProject returns null for foreign projects", async () => {
    const result = await saveBusinessProfileForProject("proj-3", "user_1", {
      businessName: "Hijack",
    });
    expect(result).toBeNull();
    expect(
      (fakeRows.find((r) => r.id === "proj-3")!.settings!.businessProfile as Record<string, unknown>)
        .businessName,
    ).toBe("Other User Biz");
  });

  it("getDefaultBusinessProfile resolves the most recent profile", async () => {
    // proj-1 (07:00) has a profile; proj-2 (08:00) does not yet.
    const p = await getDefaultBusinessProfile("user_1");
    expect(p?.businessName).toBe("Acme");
  });

  it("getDefaultBusinessProfile returns null when the user has none", async () => {
    fakeRows.forEach((r) => {
      r.settings = {};
    });
    expect(await getDefaultBusinessProfile("user_1")).toBeNull();
  });

  it("getBusinessProfile routes project-scoped and user-scoped reads", async () => {
    expect((await getBusinessProfile({ userId: "user_1", projectId: "proj-1" }))?.businessName).toBe(
      "Acme",
    );
    expect((await getBusinessProfile({ userId: "user_1" }))?.businessName).toBe("Acme");
    expect(await getBusinessProfile({ userId: "nobody" })).toBeNull();
  });
});
