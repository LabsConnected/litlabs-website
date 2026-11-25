import type { TopicPack } from "./types";

/**
 * education-courses — schools, tutors, online courses, coaches,
 * training (§2 row 16). The bar: programs with outcomes, how it
 * works, the instructor, pricing/enrollment, proof, FAQ, intake.
 */
export const EDUCATION_COURSES_PACK: TopicPack = {
  id: "education-courses",
  label: "Education & Courses",
  version: 1,
  summary:
    "A complete education site: courses and programs with outcomes, how it works, instructor about, pricing, testimonials, FAQ, and an intake form.",
  match: {
    keywords: [
      "school", "tutor", "tutoring", "courses", "course", "coaching",
      "coach", "training", "lessons", "classes", "academy", "learning",
    ],
    phrases: [
      "online courses", "tutoring services", "coaching program",
      "training program", "music lessons", "test prep",
    ],
  },
  themeDefaults: { theme: "light", accentHue: 200 },
  hero: {
    imageSubjects: [
      "teacher helping student at desk",
      "online course on laptop at home",
      "students collaborating in classroom",
      "coach mentoring young athlete",
    ],
    cta: "Apply or enroll",
    requiredElements: ["outcome in headline", "who it is for line"],
  },
  requiredSections: [
    {
      kind: "services", label: "Courses & programs", headingHints: ["Courses & programs", "Programs"],
      minItems: 4, requiredFields: ["title", "text"],
      notes: "Each course/program with its OUTCOME in the text (what the learner can do after), level, and format.",
    },
    {
      kind: "process", label: "How it works", headingHints: ["How it works", "How learning works"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Intake/placement → plan → sessions/course → progress checks, in plain steps.",
    },
    {
      kind: "gallery", label: "Learning in action", headingHints: ["Gallery", "In session"],
      minItems: 4,
      notes: "Real teaching moments — classroom, studio, screen.",
    },
    {
      kind: "about", label: "Meet the instructor", headingHints: ["Meet the instructor", "About"],
      notes: "The instructor/founder: credentials, years teaching, approach in their own words.",
    },
    {
      kind: "pricing", label: "Pricing & enrollment", headingHints: ["Pricing", "Tuition"],
      minItems: 3,
      notes: "Programs with real prices or tuition shape, and what enrollment includes.",
    },
    {
      kind: "testimonials", label: "Student words", headingHints: ["Student words", "Results"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named students/parents with the outcome they reached.",
    },
    {
      kind: "faq", label: "FAQ", headingHints: ["FAQ", "Common questions"],
      minItems: 4,
      notes: "Scheduling, refunds, materials, age/level fit.",
    },
    {
      kind: "form", label: "Intake form", headingHints: ["Apply", "Get started"],
      minItems: 5,
      notes: "The intake form from the form block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Visit us"],
      notes: "Location if in-person, email, phone.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "School name, contact line." },
  ],
  optionalSections: [
    { kind: "stats", label: "Outcomes", headingHints: ["Outcomes", "By the numbers"], minItems: 3, notes: "Students taught, years, completion — only when real." },
    { kind: "cta", label: "Enroll band", headingHints: ["Seats are limited"], notes: "One enrollment call band with the real deadline if any." },
  ],
  requiredBlocks: [
    {
      block: "form", formKind: "intake",
      fields: ["name", "email", "phone", "program", "message"],
      notes: "Intake posts to the platform form endpoint.",
    },
    { block: "payments", notes: "Priced programs satisfy the payments block." },
    { block: "gallery", notes: "Teaching in action." },
    { block: "reviews", notes: "Named student words." },
  ],
  images: {
    required: [
      "teacher helping student at desk",
      "online course on laptop at home",
      "students collaborating in classroom",
      "coach mentoring young athlete",
    ],
    allowed: [
      "library study table books",
      "music lesson piano hands",
      "graduation caps celebration",
      "whiteboard lesson math",
      "kids science experiment class",
    ],
    banned: ["office meeting", "car repair", "restaurant food", "roofing work"],
  },
  copy: {
    tone: "Encouraging and specific — outcomes and structure over inspiration; no guaranteed grades or jobs.",
    mustMention: ["free intro session", "all levels welcome"],
    bannedPhrases: ["guaranteed results", "get rich quick", "ace every test guaranteed", "world-class education"],
  },
  seo: {
    titlePattern: "{Business} — Courses & Coaching in {City}, {State}",
    descriptionPattern:
      "{Business} offers courses and coaching in {City} — programs with real outcomes, how it works, pricing, and a free intro session.",
    localKeywords: ["tutoring near me", "online courses", "coaching program", "lessons"],
    schemaType: "EducationalOrganization",
  },
  completeness: { minSections: 9, galleryMinImages: 4, testimonialsMin: 2 },
};
