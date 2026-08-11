/**
 * Section Blocks Library — pre-built complete sections for the Canvas.
 *
 * Each block is a self-contained section with multiple visual variants.
 * Users drag these onto the canvas instead of assembling from primitives.
 *
 * Categories:
 *   - Navigation (navbar, footer, announcement bar)
 *   - Hero (centered, split, video bg, minimal)
 *   - Content (features, bento, stats, logo cloud, testimonials)
 *   - Conversion (pricing, CTA, newsletter, contact form, FAQ)
 *   - Social (team, timeline, portfolio, gallery)
 *   - Commerce (product grid, product detail, cart, checkout)
 *   - App UI (dashboard stats, table, activity feed, settings, login)
 */

import { createNode, type CanvasNode, type SectionTemplate } from "./types";

// Helper: create a section with children already wired up
function makeSection(
  styles: Record<string, unknown>,
  children: CanvasNode[],
): { node: CanvasNode; children: CanvasNode[] } {
  const section = createNode("section");
  section.styles = { ...section.styles, ...styles } as CanvasNode["styles"];
  section.children = children.map((c) => c.id);
  children.forEach((c) => { c.parentId = section.id; });
  return { node: section, children };
}

function h(text: string, level: 1 | 2 | 3 = 2, fontSize = 32, color = "var(--text-primary)") {
  const n = createNode("heading");
  n.props = { text, level };
  n.styles = { fontSize, fontWeight: "700", textAlign: "center", color };
  return n;
}

function txt(text: string, fontSize = 14, color = "var(--text-secondary)") {
  const n = createNode("text");
  n.props = { text };
  n.styles = { fontSize, textAlign: "center", color };
  return n;
}

function btn(text: string, bg = "#9b4dff", color = "#fff") {
  const n = createNode("button");
  n.props = { text, href: "#" };
  n.styles = { padding: "12px 28px", borderRadius: 10, backgroundColor: bg, color, fontSize: 15, fontWeight: "700", textAlign: "center" };
  return n;
}

function card(title: string, desc: string, flex = "1") {
  const c = createNode("card");
  c.styles = { padding: "24px", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 10, borderWidth: 1, borderColor: "var(--studio-border-strong)", borderStyle: "solid", flex };
  const heading = h(title, 3, 18, "var(--text-primary)");
  heading.styles.textAlign = "left";
  const desc_ = txt(desc, 13);
  desc_.styles.textAlign = "left";
  c.children = [heading.id, desc_.id];
  heading.parentId = c.id;
  desc_.parentId = c.id;
  return { card: c, children: [heading, desc_] };
}

function columns(count: number, gap = 24) {
  const c = createNode("columns");
  c.props = { columns: count };
  c.styles = { display: "flex", flexDirection: "row", gap };
  return c;
}

// ─── Navigation ────────────────────────────────────────────────────

export const NAVBAR_MINIMAL: SectionTemplate = {
  id: "navbar-minimal",
  label: "Navbar Minimal",
  icon: "Menu",
  build: () => {
    const logo = h("Brand", 3, 20);
    logo.styles.textAlign = "left";
    const link1 = createNode("link");
    link1.props = { text: "Features", href: "#" };
    const link2 = createNode("link");
    link2.props = { text: "Pricing", href: "#" };
    const link3 = createNode("link");
    link3.props = { text: "About", href: "#" };
    const cta = btn("Sign Up", "transparent", "var(--glass-purple)");
    cta.styles.borderWidth = 1; cta.styles.borderColor = "var(--glass-purple)"; cta.styles.borderStyle = "solid";
    const nav = createNode("container");
    nav.styles = { display: "flex", flexDirection: "row", gap: 24, alignItems: "center" };
    nav.children = [link1.id, link2.id, link3.id];
    [link1, link2, link3].forEach((l) => { l.parentId = nav.id; });
    const right = createNode("container");
    right.styles = { display: "flex", flexDirection: "row", gap: 12, alignItems: "center" };
    right.children = [nav.id, cta.id];
    nav.parentId = right.id; cta.parentId = right.id;
    return makeSection(
      { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: "14px 32px", backgroundColor: "rgba(255,255,255,0.02)" },
      [logo, right],
    );
  },
};

export const FOOTER_SIMPLE: SectionTemplate = {
  id: "footer-simple",
  label: "Footer Simple",
  icon: "PanelBottom",
  build: () => {
    const brand = h("Brand", 3, 18);
    brand.styles.textAlign = "left";
    const copyright = txt("© 2025 Brand. All rights reserved.", 12, "var(--text-muted)");
    copyright.styles.textAlign = "left";
    const col1 = createNode("container");
    col1.styles = { display: "flex", flexDirection: "column", gap: 8, flex: "1" };
    const links1 = ["Product", "Features", "Pricing"].map((t) => {
      const l = createNode("link"); l.props = { text: t, href: "#" }; l.parentId = col1.id; return l;
    });
    col1.children = links1.map((l) => l.id);
    const col2 = createNode("container");
    col2.styles = { display: "flex", flexDirection: "column", gap: 8, flex: "1" };
    const links2 = ["Company", "About", "Blog"].map((t) => {
      const l = createNode("link"); l.props = { text: t, href: "#" }; l.parentId = col2.id; return l;
    });
    col2.children = links2.map((l) => l.id);
    const cols = columns(2, 48);
    cols.children = [col1.id, col2.id];
    col1.parentId = cols.id; col2.parentId = cols.id;
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 32, padding: "48px 32px", backgroundColor: "rgba(0,0,0,0.2)" },
      [brand, cols, copyright],
    );
  },
};

export const ANNOUNCEMENT_BAR: SectionTemplate = {
  id: "announcement-bar",
  label: "Announcement Bar",
  icon: "Megaphone",
  build: () => {
    const msg = txt("🎉 We just launched v2.0 — check out what's new!", 13, "#fff");
    const link = createNode("link");
    link.props = { text: "Learn more →", href: "#" };
    link.styles = { color: "#fff", fontWeight: "600", fontSize: 13 };
    const inner = createNode("container");
    inner.styles = { display: "flex", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" };
    inner.children = [msg.id, link.id];
    msg.parentId = inner.id; link.parentId = inner.id;
    return makeSection(
      { display: "flex", flexDirection: "row", justifyContent: "center", padding: "8px 24px", backgroundColor: "#9b4dff" },
      [inner],
    );
  },
};

// ─── Hero Sections ─────────────────────────────────────────────────

export const HERO_CENTERED: SectionTemplate = {
  id: "hero-centered",
  label: "Hero Centered",
  icon: "Sparkles",
  build: () => {
    const badge = createNode("badge");
    badge.props = { text: "✨ New", badgeVariant: "default" };
    const title = h("Build Something Amazing", 1, 52);
    const subtitle = txt("Your vision, powered by LiTTree. Start building your dream project today.", 18);
    subtitle.styles.maxWidth = "560px";
    const ctaRow = createNode("container");
    ctaRow.styles = { display: "flex", flexDirection: "row", gap: 12, alignItems: "center" };
    const b1 = btn("Get Started");
    const b2 = btn("Learn More", "transparent", "var(--glass-text-2)");
    b2.styles.borderWidth = 1; b2.styles.borderColor = "var(--glass-border)"; b2.styles.borderStyle = "solid";
    ctaRow.children = [b1.id, b2.id];
    b1.parentId = ctaRow.id; b2.parentId = ctaRow.id;
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 24, alignItems: "center", justifyContent: "center", padding: "100px 48px", minHeight: "500px", backgroundColor: "rgba(139,92,246,0.05)" },
      [badge, title, subtitle, ctaRow],
    );
  },
};

export const HERO_SPLIT: SectionTemplate = {
  id: "hero-split",
  label: "Hero Split",
  icon: "Columns2",
  build: () => {
    const title = h("Launch Faster with LiTT", 1, 44);
    title.styles.textAlign = "left";
    const subtitle = txt("The AI-native builder that turns ideas into production-ready apps.", 16);
    subtitle.styles.textAlign = "left";
    subtitle.styles.maxWidth = "400px";
    const cta = btn("Start Building");
    cta.styles.textAlign = "left";
    const left = createNode("container");
    left.styles = { display: "flex", flexDirection: "column", gap: 20, flex: "1", justifyContent: "center" };
    left.children = [title.id, subtitle.id, cta.id];
    [title, subtitle, cta].forEach((n) => { n.parentId = left.id; });
    const img = createNode("image");
    img.props = { src: "", alt: "Hero visual" };
    img.styles = { borderRadius: 16, width: "100%", height: "320px", backgroundColor: "rgba(255,255,255,0.05)" };
    const right = createNode("container");
    right.styles = { display: "flex", flexDirection: "column", flex: "1" };
    right.children = [img.id];
    img.parentId = right.id;
    const cols = columns(2, 48);
    cols.children = [left.id, right.id];
    left.parentId = cols.id; right.parentId = cols.id;
    return makeSection(
      { display: "flex", flexDirection: "column", padding: "80px 48px", minHeight: "400px" },
      [cols],
    );
  },
};

export const HERO_VIDEO: SectionTemplate = {
  id: "hero-video",
  label: "Hero Video BG",
  icon: "Video",
  build: () => {
    const title = h("Experience the Future", 1, 48);
    const subtitle = txt("Immersive video backgrounds that captivate your audience.", 16);
    const cta = btn("Watch Demo");
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 24, alignItems: "center", justifyContent: "center", padding: "120px 48px", minHeight: "500px", backgroundColor: "rgba(0,0,0,0.5)" },
      [title, subtitle, cta],
    );
  },
};

// ─── Content Sections ──────────────────────────────────────────────

export const FEATURES_GRID: SectionTemplate = {
  id: "features-grid",
  label: "Features Grid",
  icon: "Grid3x3",
  build: () => {
    const title = h("Everything You Need", 2, 36);
    const cols = columns(3, 24);
    const features = [
      { t: "Lightning Fast", d: "Built for speed with optimized rendering" },
      { t: "Secure by Default", d: "Enterprise-grade security out of the box" },
      { t: "Infinitely Scalable", d: "Grows with your needs, no limits" },
    ];
    const allChildren: CanvasNode[] = [];
    const cardNodes: CanvasNode[] = [];
    for (const f of features) {
      const { card: c, children } = card(f.t, f.d);
      cardNodes.push(c);
      allChildren.push(c, ...children);
    }
    cols.children = cardNodes.map((c) => c.id);
    cardNodes.forEach((c) => { c.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 32, padding: "80px 48px" },
      [title, cols, ...allChildren],
    );
  },
};

export const BENTO_GRID: SectionTemplate = {
  id: "bento-grid",
  label: "Bento Grid",
  icon: "LayoutGrid",
  build: () => {
    const title = h("Why Teams Choose Us", 2, 32);
    const cols = columns(3, 16);
    const items = [
      { t: "AI-Powered", d: "Smart suggestions throughout" },
      { t: "Real-time", d: "Live collaboration built in" },
      { t: "Analytics", d: "Deep insights at your fingertips" },
      { t: "Integrations", d: "Connect your favorite tools" },
      { t: "Customizable", d: "Make it truly yours" },
      { t: "24/7 Support", d: "We're always here to help" },
    ];
    const allChildren: CanvasNode[] = [];
    const cardNodes: CanvasNode[] = [];
    for (const item of items) {
      const { card: c, children } = card(item.t, item.d);
      cardNodes.push(c);
      allChildren.push(c, ...children);
    }
    cols.children = cardNodes.map((c) => c.id);
    cardNodes.forEach((c) => { c.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 24, padding: "64px 48px" },
      [title, cols, ...allChildren],
    );
  },
};

export const STATS_ROW: SectionTemplate = {
  id: "stats-row",
  label: "Stats Row",
  icon: "BarChart3",
  build: () => {
    const cols = columns(4, 24);
    const stats = [
      { num: "10K+", label: "Active Users" },
      { num: "99.9%", label: "Uptime" },
      { num: "150+", label: "Integrations" },
      { num: "4.9★", label: "User Rating" },
    ];
    const allChildren: CanvasNode[] = [];
    const cardNodes: CanvasNode[] = [];
    for (const s of stats) {
      const c = createNode("card");
      c.styles = { padding: "28px", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.03)", display: "flex", flexDirection: "column", gap: 4, alignItems: "center", flex: "1" };
      const num = h(s.num, 3, 36, "var(--glass-purple)");
      const label = txt(s.label, 13);
      c.children = [num.id, label.id];
      num.parentId = c.id; label.parentId = c.id;
      cardNodes.push(c);
      allChildren.push(c, num, label);
    }
    cols.children = cardNodes.map((c) => c.id);
    cardNodes.forEach((c) => { c.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", padding: "48px 48px", backgroundColor: "rgba(139,92,246,0.03)" },
      [cols, ...allChildren],
    );
  },
};

export const LOGO_CLOUD: SectionTemplate = {
  id: "logo-cloud",
  label: "Logo Cloud",
  icon: "Building2",
  build: () => {
    const title = txt("Trusted by teams at", 13, "var(--text-muted)");
    const cols = columns(5, 32);
    const logos = ["Acme", "Globex", "Initech", "Umbrella", "Hooli"];
    const allChildren: CanvasNode[] = [];
    const logoNodes: CanvasNode[] = [];
    for (const name of logos) {
      const l = h(name, 3, 18, "var(--text-muted)");
      l.styles.fontWeight = "600";
      logoNodes.push(l);
      allChildren.push(l);
    }
    cols.children = logoNodes.map((l) => l.id);
    logoNodes.forEach((l) => { l.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 24, padding: "48px 48px", alignItems: "center" },
      [title, cols, ...allChildren],
    );
  },
};

export const TESTIMONIALS: SectionTemplate = {
  id: "testimonials",
  label: "Testimonials",
  icon: "Quote",
  build: () => {
    const title = h("Loved by Builders", 2, 36);
    const cols = columns(3, 24);
    const testimonials = [
      { quote: "LiTT changed how we build. What took weeks now takes hours.", name: "Sarah Chen", role: "CTO, TechFlow" },
      { quote: "The AI copilot is like having a senior dev pair-programming 24/7.", name: "Marcus Reid", role: "Founder, StartupX" },
      { quote: "We shipped our product in 3 days. Unreal.", name: "Aisha Patel", role: "PM, BigCorp" },
    ];
    const allChildren: CanvasNode[] = [];
    const cardNodes: CanvasNode[] = [];
    for (const t of testimonials) {
      const c = createNode("card");
      c.styles = { padding: "28px", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 16, flex: "1" };
      const quote = txt(t.quote, 14);
      quote.styles.textAlign = "left";
      const avatar = createNode("avatar");
      avatar.props = { avatarName: t.name, avatarSrc: "" };
      avatar.styles = { width: "36px", height: "36px", borderRadius: 999 };
      const name = h(t.name, 3, 14);
      name.styles.textAlign = "left";
      const role = txt(t.role, 12, "var(--text-muted)");
      role.styles.textAlign = "left";
      const info = createNode("container");
      info.styles = { display: "flex", flexDirection: "row", gap: 10, alignItems: "center" };
      info.children = [avatar.id, name.id];
      avatar.parentId = info.id; name.parentId = info.id;
      c.children = [quote.id, info.id, role.id];
      quote.parentId = c.id; info.parentId = c.id; role.parentId = c.id;
      cardNodes.push(c);
      allChildren.push(c, quote, avatar, name, info, role);
    }
    cols.children = cardNodes.map((c) => c.id);
    cardNodes.forEach((c) => { c.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 32, padding: "80px 48px" },
      [title, cols, ...allChildren],
    );
  },
};

// ─── Conversion Sections ───────────────────────────────────────────

export const PRICING_TIERS: SectionTemplate = {
  id: "pricing-tiers",
  label: "Pricing Tiers",
  icon: "Tag",
  build: () => {
    const title = h("Simple, Transparent Pricing", 2, 36);
    const cols = columns(3, 24);
    const plans = [
      { name: "Starter", price: "$0", desc: "Perfect for trying out", featured: false },
      { name: "Pro", price: "$29", desc: "For growing projects", featured: true },
      { name: "Enterprise", price: "$99", desc: "Unlimited everything", featured: false },
    ];
    const allChildren: CanvasNode[] = [];
    const cardNodes: CanvasNode[] = [];
    for (const plan of plans) {
      const c = createNode("card");
      const bg = plan.featured ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.05)";
      const border = plan.featured ? "var(--glass-purple)" : "var(--studio-border-strong)";
      c.styles = { padding: "32px", borderRadius: 16, backgroundColor: bg, display: "flex", flexDirection: "column", gap: 16, borderWidth: plan.featured ? 2 : 1, borderColor: border, borderStyle: "solid", flex: "1" };
      const name = h(plan.name, 3, 20);
      name.styles.textAlign = "left";
      const price = h(plan.price, 3, 40, "var(--glass-purple)");
      price.styles.textAlign = "left";
      const desc = txt(plan.desc, 13);
      desc.styles.textAlign = "left";
      const b = btn("Choose Plan", plan.featured ? "#9b4dff" : "transparent", plan.featured ? "#fff" : "var(--glass-text-2)");
      if (!plan.featured) { b.styles.borderWidth = 1; b.styles.borderColor = "var(--glass-border)"; b.styles.borderStyle = "solid"; }
      c.children = [name.id, price.id, desc.id, b.id];
      [name, price, desc, b].forEach((n) => { n.parentId = c.id; });
      cardNodes.push(c);
      allChildren.push(c, name, price, desc, b);
    }
    cols.children = cardNodes.map((c) => c.id);
    cardNodes.forEach((c) => { c.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 32, padding: "80px 48px" },
      [title, cols, ...allChildren],
    );
  },
};

export const CTA_SECTION: SectionTemplate = {
  id: "cta-section",
  label: "CTA Section",
  icon: "Megaphone",
  build: () => {
    const title = h("Ready to Build Something Great?", 2, 36);
    const subtitle = txt("Join thousands of builders using LiTTree to ship faster.", 16);
    const b = btn("Get Started Free");
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 20, alignItems: "center", padding: "80px 48px", backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 16 },
      [title, subtitle, b],
    );
  },
};

export const NEWSLETTER: SectionTemplate = {
  id: "newsletter",
  label: "Newsletter",
  icon: "Mail",
  build: () => {
    const title = h("Stay in the Loop", 2, 28);
    const subtitle = txt("Get the latest updates, tips, and product news.", 14);
    const input = createNode("input");
    input.props = { placeholder: "you@example.com", inputType: "email", inputName: "email" };
    input.styles = { flex: "1", padding: "12px 16px", borderRadius: 10, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "var(--glass-border)", borderStyle: "solid", fontSize: 14, color: "var(--text-primary)" };
    const b = btn("Subscribe");
    const formRow = createNode("container");
    formRow.styles = { display: "flex", flexDirection: "row", gap: 8, maxWidth: "440px", width: "100%" };
    formRow.children = [input.id, b.id];
    input.parentId = formRow.id; b.parentId = formRow.id;
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 16, alignItems: "center", padding: "64px 48px", backgroundColor: "rgba(255,255,255,0.02)" },
      [title, subtitle, formRow, input, b],
    );
  },
};

export const FAQ_SECTION: SectionTemplate = {
  id: "faq-section",
  label: "FAQ",
  icon: "HelpCircle",
  build: () => {
    const title = h("Frequently Asked Questions", 2, 32);
    const acc = createNode("accordion");
    acc.props = {
      accordionItems: [
        { title: "How does LiTT work?", content: "LiTT uses AI to understand your intent and builds the UI for you." },
        { title: "Is there a free plan?", content: "Yes! The Starter plan is free forever with generous limits." },
        { title: "Can I export my code?", content: "Absolutely. You own everything you build and can export at any time." },
        { title: "Do you support team collaboration?", content: "Yes, real-time collaboration is available on Pro and Enterprise plans." },
      ],
    };
    acc.styles = { display: "flex", flexDirection: "column", gap: 8, maxWidth: "640px", width: "100%" };
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 32, alignItems: "center", padding: "80px 48px" },
      [title, acc],
    );
  },
};

export const CONTACT_FORM: SectionTemplate = {
  id: "contact-form",
  label: "Contact Form",
  icon: "Mail",
  build: () => {
    const title = h("Get in Touch", 2, 32);
    const nameInput = createNode("input");
    nameInput.props = { placeholder: "Your name", inputType: "text", inputName: "name" };
    const emailInput = createNode("input");
    emailInput.props = { placeholder: "Your email", inputType: "email", inputName: "email" };
    const msgInput = createNode("textarea");
    msgInput.props = { placeholder: "Your message...", rows: 5, inputName: "message" };
    const submit = btn("Send Message");
    const form = createNode("form");
    form.styles = { display: "flex", flexDirection: "column", gap: 12, maxWidth: "480px", width: "100%", padding: "32px", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.03)" };
    form.children = [nameInput.id, emailInput.id, msgInput.id, submit.id];
    [nameInput, emailInput, msgInput, submit].forEach((n) => { n.parentId = form.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 24, alignItems: "center", padding: "80px 48px" },
      [title, form, nameInput, emailInput, msgInput, submit],
    );
  },
};

// ─── Social Sections ───────────────────────────────────────────────

export const TEAM_GRID: SectionTemplate = {
  id: "team-grid",
  label: "Team Grid",
  icon: "Users",
  build: () => {
    const title = h("Meet the Team", 2, 32);
    const cols = columns(4, 20);
    const members = [
      { name: "Alex Rivera", role: "CEO" },
      { name: "Sam Park", role: "CTO" },
      { name: "Jordan Lee", role: "Design" },
      { name: "Casey Wu", role: "Engineering" },
    ];
    const allChildren: CanvasNode[] = [];
    const cardNodes: CanvasNode[] = [];
    for (const m of members) {
      const c = createNode("card");
      c.styles = { padding: "24px", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.03)", display: "flex", flexDirection: "column", gap: 12, alignItems: "center", flex: "1" };
      const avatar = createNode("avatar");
      avatar.props = { avatarName: m.name, avatarSrc: "" };
      avatar.styles = { width: "64px", height: "64px", borderRadius: 999 };
      const name = h(m.name, 3, 16);
      const role = txt(m.role, 12, "var(--text-muted)");
      c.children = [avatar.id, name.id, role.id];
      [avatar, name, role].forEach((n) => { n.parentId = c.id; });
      cardNodes.push(c);
      allChildren.push(c, avatar, name, role);
    }
    cols.children = cardNodes.map((c) => c.id);
    cardNodes.forEach((c) => { c.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 32, padding: "80px 48px" },
      [title, cols, ...allChildren],
    );
  },
};

export const GALLERY_GRID: SectionTemplate = {
  id: "gallery-grid",
  label: "Gallery Grid",
  icon: "Images",
  build: () => {
    const title = h("Gallery", 2, 32);
    const cols = columns(3, 16);
    const allChildren: CanvasNode[] = [];
    const imgNodes: CanvasNode[] = [];
    for (let i = 0; i < 6; i++) {
      const img = createNode("image");
      img.props = { src: "", alt: `Gallery image ${i + 1}` };
      img.styles = { borderRadius: 12, width: "100%", height: "200px", backgroundColor: "rgba(255,255,255,0.05)" };
      imgNodes.push(img);
      allChildren.push(img);
    }
    cols.children = imgNodes.map((img) => img.id);
    imgNodes.forEach((img) => { img.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 24, padding: "64px 48px" },
      [title, cols, ...allChildren],
    );
  },
};

// ─── App UI Sections ───────────────────────────────────────────────

export const DASHBOARD_STATS: SectionTemplate = {
  id: "dashboard-stats",
  label: "Dashboard Stats",
  icon: "LayoutDashboard",
  build: () => {
    const cols = columns(4, 16);
    const stats = [
      { label: "Revenue", value: "$48.2K", change: "+12%" },
      { label: "Users", value: "2,847", change: "+8%" },
      { label: "Orders", value: "1,205", change: "+23%" },
      { label: "Churn", value: "1.2%", change: "-0.3%" },
    ];
    const allChildren: CanvasNode[] = [];
    const cardNodes: CanvasNode[] = [];
    for (const s of stats) {
      const c = createNode("card");
      c.styles = { padding: "20px", borderRadius: 12, backgroundColor: "rgba(255,255,255,0.03)", display: "flex", flexDirection: "column", gap: 8, flex: "1" };
      const label = txt(s.label, 12, "var(--text-muted)");
      label.styles.textAlign = "left";
      const value = h(s.value, 3, 24);
      value.styles.textAlign = "left";
      const change = createNode("badge");
      change.props = { text: s.change, badgeVariant: s.change.startsWith("-") ? "error" : "success" };
      c.children = [label.id, value.id, change.id];
      [label, value, change].forEach((n) => { n.parentId = c.id; });
      cardNodes.push(c);
      allChildren.push(c, label, value, change);
    }
    cols.children = cardNodes.map((c) => c.id);
    cardNodes.forEach((c) => { c.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 16, padding: "24px" },
      [cols, ...allChildren],
    );
  },
};

export const DATA_TABLE: SectionTemplate = {
  id: "data-table",
  label: "Data Table",
  icon: "Table",
  build: () => {
    const title = h("Recent Orders", 3, 20);
    title.styles.textAlign = "left";
    const table = createNode("table");
    table.props = {
      tableHeaders: ["Order ID", "Customer", "Amount", "Status", "Date"],
      tableRows: [
        ["#1001", "Alice Johnson", "$129.00", "Paid", "2025-01-15"],
        ["#1002", "Bob Smith", "$89.50", "Pending", "2025-01-16"],
        ["#1003", "Carol Davis", "$245.00", "Paid", "2025-01-17"],
        ["#1004", "Dan Wilson", "$59.99", "Refunded", "2025-01-18"],
      ],
    };
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 16, padding: "24px" },
      [title, table],
    );
  },
};

export const LOGIN_FORM: SectionTemplate = {
  id: "login-form",
  label: "Login Form",
  icon: "LogIn",
  build: () => {
    const title = h("Welcome Back", 2, 28);
    const emailInput = createNode("input");
    emailInput.props = { placeholder: "you@example.com", inputType: "email", inputName: "email" };
    const passInput = createNode("input");
    passInput.props = { placeholder: "Password", inputType: "password", inputName: "password" };
    const checkbox = createNode("checkbox");
    checkbox.props = { label: "Remember me", checked: false };
    const submit = btn("Sign In");
    submit.styles.width = "100%";
    const form = createNode("form");
    form.styles = { display: "flex", flexDirection: "column", gap: 14, maxWidth: "360px", width: "100%", padding: "32px", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.03)" };
    form.children = [emailInput.id, passInput.id, checkbox.id, submit.id];
    [emailInput, passInput, checkbox, submit].forEach((n) => { n.parentId = form.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 24, alignItems: "center", justifyContent: "center", padding: "80px 48px", minHeight: "400px" },
      [title, form, emailInput, passInput, checkbox, submit],
    );
  },
};

export const SIGNUP_FORM: SectionTemplate = {
  id: "signup-form",
  label: "Signup Form",
  icon: "UserPlus",
  build: () => {
    const title = h("Create Account", 2, 28);
    const nameInput = createNode("input");
    nameInput.props = { placeholder: "Full name", inputType: "text", inputName: "name" };
    const emailInput = createNode("input");
    emailInput.props = { placeholder: "you@example.com", inputType: "email", inputName: "email" };
    const passInput = createNode("input");
    passInput.props = { placeholder: "Password", inputType: "password", inputName: "password" };
    const checkbox = createNode("checkbox");
    checkbox.props = { label: "I agree to the Terms of Service", checked: false };
    const submit = btn("Create Account");
    submit.styles.width = "100%";
    const form = createNode("form");
    form.styles = { display: "flex", flexDirection: "column", gap: 14, maxWidth: "360px", width: "100%", padding: "32px", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.03)" };
    form.children = [nameInput.id, emailInput.id, passInput.id, checkbox.id, submit.id];
    [nameInput, emailInput, passInput, checkbox, submit].forEach((n) => { n.parentId = form.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 24, alignItems: "center", justifyContent: "center", padding: "80px 48px", minHeight: "400px" },
      [title, form, nameInput, emailInput, passInput, checkbox, submit],
    );
  },
};

// ─── Commerce Sections ─────────────────────────────────────────────

export const PRODUCT_GRID: SectionTemplate = {
  id: "product-grid",
  label: "Product Grid",
  icon: "ShoppingBag",
  build: () => {
    const title = h("Featured Products", 2, 32);
    const cols = columns(3, 20);
    const products = [
      { name: "Product One", price: "$49" },
      { name: "Product Two", price: "$79" },
      { name: "Product Three", price: "$99" },
    ];
    const allChildren: CanvasNode[] = [];
    const cardNodes: CanvasNode[] = [];
    for (const p of products) {
      const c = createNode("card");
      c.styles = { padding: "0", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.03)", display: "flex", flexDirection: "column", gap: 0, flex: "1", overflow: "hidden" };
      const img = createNode("image");
      img.props = { src: "", alt: p.name };
      img.styles = { width: "100%", height: "180px", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 0 };
      const info = createNode("container");
      info.styles = { padding: "16px", display: "flex", flexDirection: "column", gap: 8 };
      const name = h(p.name, 3, 16);
      name.styles.textAlign = "left";
      const price = h(p.price, 3, 20, "var(--glass-purple)");
      price.styles.textAlign = "left";
      const addBtn = btn("Add to Cart", "transparent", "var(--glass-purple)");
      addBtn.styles.borderWidth = 1; addBtn.styles.borderColor = "var(--glass-purple)"; addBtn.styles.borderStyle = "solid";
      addBtn.styles.width = "100%";
      info.children = [name.id, price.id, addBtn.id];
      [name, price, addBtn].forEach((n) => { n.parentId = info.id; });
      c.children = [img.id, info.id];
      img.parentId = c.id; info.parentId = c.id;
      cardNodes.push(c);
      allChildren.push(c, img, info, name, price, addBtn);
    }
    cols.children = cardNodes.map((c) => c.id);
    cardNodes.forEach((c) => { c.parentId = cols.id; });
    return makeSection(
      { display: "flex", flexDirection: "column", gap: 32, padding: "64px 48px" },
      [title, cols, ...allChildren],
    );
  },
};

// ─── Master Export ─────────────────────────────────────────────────

export const SECTION_BLOCKS: SectionTemplate[] = [
  // Navigation
  NAVBAR_MINIMAL,
  FOOTER_SIMPLE,
  ANNOUNCEMENT_BAR,
  // Hero
  HERO_CENTERED,
  HERO_SPLIT,
  HERO_VIDEO,
  // Content
  FEATURES_GRID,
  BENTO_GRID,
  STATS_ROW,
  LOGO_CLOUD,
  TESTIMONIALS,
  // Conversion
  PRICING_TIERS,
  CTA_SECTION,
  NEWSLETTER,
  FAQ_SECTION,
  CONTACT_FORM,
  // Social
  TEAM_GRID,
  GALLERY_GRID,
  // App UI
  DASHBOARD_STATS,
  DATA_TABLE,
  LOGIN_FORM,
  SIGNUP_FORM,
  // Commerce
  PRODUCT_GRID,
];

export const BLOCK_CATEGORIES: { id: string; label: string; blocks: SectionTemplate[] }[] = [
  { id: "navigation", label: "Navigation", blocks: [NAVBAR_MINIMAL, FOOTER_SIMPLE, ANNOUNCEMENT_BAR] },
  { id: "hero", label: "Hero", blocks: [HERO_CENTERED, HERO_SPLIT, HERO_VIDEO] },
  { id: "content", label: "Content", blocks: [FEATURES_GRID, BENTO_GRID, STATS_ROW, LOGO_CLOUD, TESTIMONIALS] },
  { id: "conversion", label: "Conversion", blocks: [PRICING_TIERS, CTA_SECTION, NEWSLETTER, FAQ_SECTION, CONTACT_FORM] },
  { id: "social", label: "Social", blocks: [TEAM_GRID, GALLERY_GRID] },
  { id: "app-ui", label: "App UI", blocks: [DASHBOARD_STATS, DATA_TABLE, LOGIN_FORM, SIGNUP_FORM] },
  { id: "commerce", label: "Commerce", blocks: [PRODUCT_GRID] },
];
