import { describe, it, expect } from "vitest";
import { applySectionEdit, validateSitePlan, composeSiteHtml, type SitePlan } from "./site-compose";

const VALID_PLAN = {
  title: "Ember Roast",
  description: "Artisan coffee roastery",
  theme: "warm",
  accentHue: 28,
  hero: { heading: "Small-batch coffee", subheading: "Roasted daily in small batches", cta: "See the menu", image: "coffee beans roast" },
  sections: [
    { kind: "features", heading: "Why Ember", items: [
      { title: "Fresh", text: "Roasted to order", icon: "cup" },
      { title: "Direct trade", text: "From partner farms", icon: "leaf" },
    ] },
    { kind: "gallery", heading: "The roastery", images: ["latte art", "roastery interior", "green beans"] },
    { kind: "pricing", heading: "Subscriptions", plans: [
      { name: "Monthly", price: "$18", features: ["1 bag / month", "Free shipping"] },
      { name: "Weekly", price: "$64", features: ["4 bags / month", "Free shipping", "Early access"] },
    ] },
    { kind: "testimonials", items: [{ quote: "Best coffee in town", author: "Maya R." }] },
    { kind: "cta", heading: "Taste the difference", button: "Visit us", href: "#contact" },
    { kind: "footer", text: "123 Roast Lane, Portland" },
  ],
};

describe("validateSitePlan", () => {
  it("accepts a valid plan", () => {
    const v = validateSitePlan(VALID_PLAN);
    expect(v.ok).toBe(true);
    expect(v.plan?.title).toBe("Ember Roast");
    expect(v.plan?.sections).toHaveLength(6);
  });

  it("rejects a non-object", () => {
    expect(validateSitePlan("html").ok).toBe(false);
    expect(validateSitePlan(null).ok).toBe(false);
  });

  it("requires title and non-empty sections", () => {
    const v = validateSitePlan({ sections: [] });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/title/);
    expect(v.errors.join(" ")).toMatch(/sections/);
  });

  it("rejects unknown section kinds with the enum listed", () => {
    const v = validateSitePlan({ title: "T", sections: [{ kind: "warp-drive" }] });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/warp-drive/);
    expect(v.errors[0]).toMatch(/features/);
  });

  it("rejects unknown themes and out-of-range accent hues", () => {
    const v = validateSitePlan({ title: "T", theme: "neon", accentHue: 720, sections: [{ kind: "about", text: "x" }] });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/neon/);
    expect(v.errors.join(" ")).toMatch(/0-360/);
  });

  it("requires items for item-bearing kinds", () => {
    const v = validateSitePlan({ title: "T", sections: [{ kind: "features" }] });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/items/);
  });

  it("requires keyword arrays for a gallery", () => {
    const v = validateSitePlan({ title: "T", sections: [{ kind: "gallery" }] });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/images/);
  });
});

describe("composeSiteHtml", () => {
  const plan = validateSitePlan(VALID_PLAN).plan as SitePlan;
  const html = composeSiteHtml(plan);

  it("emits a complete styled document", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).toContain(":root{");
    expect(html).toContain("--accent:");
    expect(html).toContain("</html>");
  });

  it("carries the required semantic structure and a11y floor", () => {
    expect(html).toContain('name="viewport"');
    expect(html).toContain("skip-link");
    expect(html).toContain("<nav");
    expect(html).toContain("<main");
    expect(html).toContain("<footer");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain(":focus-visible");
    expect(html).toContain("scroll-behavior");
  });

  it("renders every requested section kind", () => {
    for (const kind of ["features", "gallery", "pricing", "testimonials", "cta"]) {
      expect(html).toMatch(new RegExp(`id="${kind}-\\d+"`));
    }
  });

  it("emits image materialization slots, never external URLs", () => {
    expect(html).toContain('data-litt-image="latte art"');
    // Default image hero renders split — the photo as a foreground slot.
    expect(html).toContain('data-litt-image="coffee beans roast"');
    expect(html).not.toMatch(/src="https?:/);
  });

  it("banner variant puts the photo behind the hero via data-litt-bg", () => {
    const p = validateSitePlan({
      ...VALID_PLAN,
      hero: { variant: "banner", heading: "H", subheading: "S", cta: "Go", image: "coffee" },
    }).plan as SitePlan;
    const out = composeSiteHtml(p);
    expect(out).toContain('data-litt-bg="coffee"');
    expect(out).not.toMatch(/class="hero hero-split/);
  });

  it("builds functioning nav anchors from section headings", () => {
    expect(html).toMatch(/<a href="#features-\d+"/);
    expect(html).toMatch(/<a href="#gallery-\d+"/);
  });

  it("escapes model-supplied strings — the plan is data, not HTML", () => {
    const evil = validateSitePlan({
      title: "<script>alert(1)</script>",
      sections: [{ kind: "about", text: '<img src=x onerror=alert(2)>' }],
    }).plan as SitePlan;
    const out = composeSiteHtml(evil);
    expect(out).not.toContain("<script>alert");
    expect(out).not.toContain('onerror="alert');
    expect(out).toContain("&lt;script&gt;");
  });

  it("varies output across themes and accent hues", () => {
    const warm = composeSiteHtml(validateSitePlan({ ...VALID_PLAN, theme: "warm" }).plan as SitePlan);
    const dark = composeSiteHtml(validateSitePlan({ ...VALID_PLAN, theme: "dark" }).plan as SitePlan);
    const hue = composeSiteHtml(validateSitePlan({ ...VALID_PLAN, theme: "warm", accentHue: 300 }).plan as SitePlan);
    expect(warm).not.toBe(dark);
    expect(warm).not.toBe(hue);
    expect(dark).toContain('data-theme="dark"');
    expect(hue).toContain("hsl(300");
  });

  it("hero without an explicit image derives bg keywords from the title", () => {
    const p = validateSitePlan({
      ...VALID_PLAN,
      title: "Ember Roast Coffeehouse",
      hero: { heading: "H", subheading: "S", cta: "Go" },
    }).plan as SitePlan;
    const out = composeSiteHtml(p);
    expect(out).toContain('data-litt-bg="ember roast coffeehouse"');
    expect(out).not.toMatch(/hero no-image/);
  });

  it("split hero renders an image slot instead of a background", () => {
    const p = validateSitePlan({
      ...VALID_PLAN,
      hero: { variant: "split", heading: "H", subheading: "S", cta: "Go", image: "coffee" },
    }).plan as SitePlan;
    const out = composeSiteHtml(p);
    expect(out).toContain("hero-split");
    expect(out).toContain('data-litt-image="coffee"');
  });
});

describe("applySectionEdit", () => {
  const page = () => composeSiteHtml(validateSitePlan(VALID_PLAN).plan as SitePlan);

  it("splices footer text without touching the rest of the page", () => {
    const html = page();
    const r = applySectionEdit(html, "footer", { text: "Hermes local build verified" });
    expect(r.ok).toBe(true);
    expect(r.html).toContain("Hermes local build verified");
    expect(r.html).toContain("<title>Ember Roast</title>");
    expect(r.html!.slice(0, html.indexOf("<footer"))).toBe(html.slice(0, html.indexOf("<footer")));
  });

  it("edits the hero heading surgically", () => {
    const html = page();
    const r = applySectionEdit(html, "hero", { heading: "Roasted at Dawn" });
    expect(r.ok).toBe(true);
    expect(r.html).toContain("<h1>Roasted at Dawn</h1>");
    expect(r.html).toContain("site-footer");
  });

  it("targets a named section kind", () => {
    const r = applySectionEdit(page(), "features", { heading: "Our Craft" });
    expect(r.ok).toBe(true);
    expect(r.html).toContain("Our Craft");
  });

  it("fails clearly on a region that does not exist", () => {
    const r = applySectionEdit(page(), "blog", { text: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no "blog" region|apply_patch/);
  });

  it("re-renders a section when list fields are provided", () => {
    const r = applySectionEdit(page(), "pricing", { plans: [{ name: "Daily", price: "$5", features: ["One cup"] }] });
    expect(r.ok).toBe(true);
    expect(r.html).toContain("Daily");
    expect(r.html).toContain("$5");
  });

  it("escapes HTML in patched values", () => {
    const r = applySectionEdit(page(), "footer", { text: "<script>alert(1)</script>" });
    expect(r.ok).toBe(true);
    expect(r.html).not.toContain("<script>alert");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("reports no-op when no usable fields are given", () => {
    const r = applySectionEdit(page(), "footer", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nothing to change/);
  });
});

describe("new section kinds (topic packs §4.4)", () => {
  const planWith = (sections: unknown[]) =>
    validateSitePlan({ title: "Test Biz", description: "A test business site", sections }).plan as SitePlan;

  it("renders a form on the platform form plumbing", () => {
    const plan = planWith([
      { kind: "form", formKind: "quote", heading: "Get a quote", button: "Request quote", fields: [
        { name: "name", label: "Your name", type: "text", required: true },
        { name: "phone", label: "Phone", type: "tel" },
        { name: "service needed", label: "Service needed", type: "select", options: ["Repair", "Replacement"] },
        { name: "message", label: "Message", type: "textarea" },
      ] },
      { kind: "footer", text: "Test Biz" },
    ]);
    const html = composeSiteHtml(plan);
    expect(html).toContain('action="/api/forms/submit"');
    expect(html).toContain('data-litt-form="1"');
    expect(html).toContain('data-litt-form-name="quote"');
    expect(html).toContain('name="deploymentId" value=""');
    expect(html).toContain('name="website"');
    expect(html).toContain('name="service needed"');
    expect(html).toContain("Request quote");
    // The inline upgrade script ships exactly once.
    expect(html.match(/querySelectorAll\("form\[data-litt-form\]"\)/g)?.length).toBe(1);
  });

  it("renders booking on the same plumbing with a date field", () => {
    const plan = planWith([
      { kind: "booking", heading: "Book a visit", fields: [
        { name: "name", label: "Name", type: "text" },
        { name: "preferred date", label: "Preferred date", type: "date" },
        { name: "preferred time", label: "Preferred time", type: "select", options: ["Morning", "Afternoon"] },
      ] },
    ]);
    const html = composeSiteHtml(plan);
    expect(html).toContain('data-litt-form-name="contact"'.replace("contact", "booking"));
    expect(html).toContain('type="date"');
  });

  it("renders process steps numbered, faq as disclosures, areas as towns, hours as rows", () => {
    const plan = planWith([
      { kind: "process", heading: "How it works", items: [
        { title: "Inspect", text: "We look and photograph" },
        { title: "Install", text: "Crew installs in a day" },
      ] },
      { kind: "faq", heading: "FAQ", items: [{ question: "How long?", answer: "One to two days." }] },
      { kind: "areas", heading: "Service area", items: [{ town: "Grand Haven" }, { town: "Spring Lake" }], href: "https://maps.example.com/dir" },
      { kind: "hours", heading: "Hours", items: [{ day: "Monday", hours: "8 AM – 5 PM" }] },
    ]);
    const html = composeSiteHtml(plan);
    expect(html).toContain("step-num");
    expect(html).toContain("<details");
    expect(html).toContain("How long?");
    expect(html).toContain("Grand Haven");
    expect(html).toContain("Get directions");
    expect(html).toContain("Monday");
    expect(html).toContain("8 AM – 5 PM");
  });

  it("upgrades menu to price rows when items carry prices, cards when they do not", () => {
    const priced = planWith([
      { kind: "menu", heading: "Menu", items: [
        { title: "Tomato soup", text: "With basil", price: "$9", group: "Starters" },
        { title: "Ribeye", text: "28-day aged", price: "$34", group: "Mains" },
      ] },
    ]);
    const pricedHtml = composeSiteHtml(priced);
    expect(pricedHtml).toContain('class="menu-row"');
    expect(pricedHtml).toContain("$34");
    expect(pricedHtml).toContain("Starters");

    const plain = planWith([
      { kind: "menu", heading: "Services menu", items: [{ title: "Cut", text: "Consultation included" }] },
    ]);
    const plainHtml = composeSiteHtml(plain);
    expect(plainHtml).toContain('class="card"');
    expect(plainHtml).not.toContain('class="menu-row"');
  });

  it("uses seoTitle for the document title when present", () => {
    const plan = planWith([{ kind: "about", text: "About us copy that is real and specific." }]);
    plan.seoTitle = "Test Biz — Roofing Contractor in Grand Haven, MI";
    const html = composeSiteHtml(plan);
    expect(html).toContain("<title>Test Biz — Roofing Contractor in Grand Haven, MI</title>");
  });

  it("validates the new kinds' shapes", () => {
    expect(validateSitePlan({ title: "T", sections: [{ kind: "form", heading: "F" }] }).errors.join(" ")).toMatch(/fields array/);
    expect(validateSitePlan({ title: "T", sections: [{ kind: "faq", items: [{ question: "Q?" }] }] }).errors.join(" ")).toMatch(/question and an answer/);
    expect(validateSitePlan({ title: "T", sections: [{ kind: "form", fields: [{ name: "s", type: "select" }] }] }).errors.join(" ")).toMatch(/options array/);
    expect(validateSitePlan({ title: "T", sections: [{ kind: "form", fields: [{ name: "s", type: "smoke-signal" }] }] }).errors.join(" ")).toMatch(/not one of/);
    expect(validateSitePlan({ title: "T", sections: [{ kind: "areas" }] }).errors.join(" ")).toMatch(/towns array/);
    expect(validateSitePlan({ title: "T", sections: [{ kind: "hours", items: [{ day: "Mon" }] }] }).errors.join(" ")).toMatch(/day and its hours/);
  });

  it("re-renders a form section through applySectionEdit fields", () => {
    const plan = planWith([
      { kind: "form", heading: "Contact", fields: [{ name: "name", label: "Name", type: "text" }] },
      { kind: "footer", text: "Test Biz" },
    ]);
    const html = composeSiteHtml(plan);
    const r = applySectionEdit(html, "form", { fields: [{ name: "email", label: "Email", type: "email" }] });
    expect(r.ok).toBe(true);
    expect(r.html).toContain('name="email"');
    expect(r.html).not.toContain('name="name"');
  });
});
