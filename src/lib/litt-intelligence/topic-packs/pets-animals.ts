import type { TopicPack } from "./types";

/**
 * pets-animals — vets, groomers, boarding/daycare, breeders,
 * shelters/rescue (§2 row 19). The bar: services with prices,
 * booking, gallery, care/about, hours, and emergency info for vets.
 */
export const PETS_ANIMALS_PACK: TopicPack = {
  id: "pets-animals",
  label: "Pets & Animals",
  version: 1,
  summary:
    "A complete pets site: services with prices, booking, gallery, care philosophy, hours, reviews, and emergency info where relevant.",
  match: {
    keywords: [
      "pet", "pets", "dog", "cat", "vet", "veterinary", "groomer",
      "grooming", "boarding", "daycare", "kennel", "shelter", "rescue",
    ],
    phrases: [
      "dog grooming", "pet boarding", "veterinary clinic", "dog daycare",
      "animal shelter", "pet services", "dog training",
    ],
  },
  themeDefaults: { theme: "warm", accentHue: 35 },
  hero: {
    imageSubjects: [
      "happy dog playing in yard",
      "veterinarian examining puppy",
      "groomer brushing fluffy dog",
      "cat resting in sunny window",
    ],
    cta: "Book a visit",
    requiredElements: ["animals in headline", "care promise line"],
  },
  requiredSections: [
    {
      kind: "services", label: "Services & prices", headingHints: ["Services", "Services & prices"],
      minItems: 5, requiredFields: ["title", "text"],
      notes: "Each service with its price or starting price in the text — pet owners compare on price and what is included.",
    },
    {
      kind: "gallery", label: "Happy guests", headingHints: ["Happy guests", "Gallery"],
      minItems: 4,
      notes: "Real animals in the actual space — the proof of care.",
    },
    {
      kind: "about", label: "How we care", headingHints: ["How we care", "About us"],
      notes: "The care philosophy: staff, ratios, routines, and what a day looks like for the animal.",
    },
    {
      kind: "features", label: "Good to know", headingHints: ["Good to know", "Policies"],
      minItems: 2, requiredFields: ["title", "text"],
      notes: "Vaccination requirements, drop-off/pickup windows, emergency vet arrangements — the practical fine print, up front.",
    },
    {
      kind: "testimonials", label: "Pet parent words", headingHints: ["Pet parent words", "Reviews"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named pet parents naming their animal and the service.",
    },
    {
      kind: "hours", label: "Hours", headingHints: ["Hours", "Opening hours"],
      notes: "Real hours by day, boarding pickup windows included.",
    },
    {
      kind: "booking", label: "Book a visit", headingHints: ["Book a visit", "Book now"],
      minItems: 5,
      notes: "The booking request form from the booking block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Visit us"],
      notes: "Address, phone, and the after-hours emergency line for vet practices.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Business name, address, hours line." },
  ],
  optionalSections: [
    { kind: "cards", label: "Adoptable animals", headingHints: ["Adoptable animals", "Meet them"], minItems: 3, notes: "Shelters/rescues: adoptable animals with age and a line each — the pack's listing surface." },
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Questions"], minItems: 3, notes: "First visit, what to bring, cancellation." },
  ],
  requiredBlocks: [
    {
      block: "booking", formKind: "reservation",
      fields: ["name", "phone", "pet name", "service", "date"],
      notes: "Booking requests post to the platform form endpoint — request-a-time, never fake live availability.",
    },
    { block: "gallery", notes: "Animals in the space." },
    { block: "hours", notes: "Hours listed by day." },
    { block: "reviews", notes: "Named pet-parent reviews." },
  ],
  images: {
    required: [
      "happy dog playing in yard",
      "veterinarian examining puppy",
      "groomer brushing fluffy dog",
      "cat resting in sunny window",
    ],
    allowed: [
      "dog agility training outdoors",
      "kitten being bottle fed",
      "dog walker with group of dogs",
      "aquarium colorful fish",
      "child hugging adopted dog",
    ],
    banned: ["office meeting", "car repair", "restaurant food", "wild animals safari"],
  },
  copy: {
    tone: "Warm and practical — prices, requirements, and routines stated plainly; the animals are the heroes.",
    mustMention: ["book ahead", "vaccinations required"],
    bannedPhrases: ["cheapest grooming in town", "we treat pets like royalty", "guaranteed behavior results", "luxury pet resort"],
  },
  seo: {
    titlePattern: "{Business} — Pet Services in {City}, {State}",
    descriptionPattern:
      "{Business} provides pet services in {City} — services with prices, booking, hours, and reviews from local pet parents.",
    localKeywords: ["dog grooming near me", "pet boarding", "veterinarian", "dog daycare"],
    schemaType: "AnimalShelter",
  },
  completeness: { minSections: 8, galleryMinImages: 4, testimonialsMin: 2 },
};
