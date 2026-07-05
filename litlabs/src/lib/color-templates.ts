export type ColorTemplate = {
  id: string;
  title: string;
  category: "animals" | "vehicles" | "space" | "fantasy" | "nature" | "holidays" | "learning";
  difficulty: "easy" | "medium" | "hard";
  thumbnail: string;
  svg: string;
};

export const COLOR_TEMPLATE_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "animals", label: "Animals" },
  { id: "vehicles", label: "Vehicles" },
  { id: "space", label: "Space" },
  { id: "fantasy", label: "Fantasy" },
  { id: "nature", label: "Nature" },
  { id: "holidays", label: "Holidays" },
  { id: "learning", label: "Learning" },
] as const;

export const DEFAULT_COLOR_PALETTE = [
  { number: 1, color: "#ef4444", name: "Red" },
  { number: 2, color: "#f97316", name: "Orange" },
  { number: 3, color: "#eab308", name: "Yellow" },
  { number: 4, color: "#22c55e", name: "Green" },
  { number: 5, color: "#3b82f6", name: "Blue" },
  { number: 6, color: "#a855f7", name: "Purple" },
  { number: 7, color: "#ec4899", name: "Pink" },
  { number: 8, color: "#14b8a6", name: "Teal" },
  { number: 9, color: "#6366f1", name: "Indigo" },
  { number: 10, color: "#f59e0b", name: "Amber" },
  { number: 11, color: "#84cc16", name: "Lime" },
  { number: 12, color: "#06b6d4", name: "Cyan" },
];

// SVG outlines scaled to a 400x400 viewBox. Paths are simple line-art shapes.
const templates: ColorTemplate[] = [
  {
    id: "rocket",
    title: "Rocket Ship",
    category: "space",
    difficulty: "easy",
    thumbnail: "🚀",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <path d="M200 40 C260 120 280 200 280 280 L200 320 L120 280 C120 200 140 120 200 40 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M120 280 C80 300 60 340 50 380 L120 340 L120 280" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M280 280 C320 300 340 340 350 380 L280 340 L280 280" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="200" cy="180" r="40" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M170 320 L230 320 L200 360 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
    </svg>`,
  },
  {
    id: "cat",
    title: "Cute Cat",
    category: "animals",
    difficulty: "easy",
    thumbnail: "🐱",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <path d="M120 140 L120 80 L160 120" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M280 140 L280 80 L240 120" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <ellipse cx="200" cy="220" rx="100" ry="90" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="170" cy="200" r="12" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="230" cy="200" r="12" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 210 L190 230 L210 230 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M180 250 Q200 270 220 250" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M140 260 Q120 300 160 310" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M260 260 Q280 300 240 310" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "butterfly",
    title: "Butterfly",
    category: "animals",
    difficulty: "medium",
    thumbnail: "🦋",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <path d="M200 120 L200 280" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 120 C140 60 60 100 60 180 C60 260 140 280 200 220" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 120 C260 60 340 100 340 180 C340 260 260 280 200 220" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 220 C140 260 60 260 60 320 C60 380 160 360 200 280" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 220 C260 260 340 260 340 320 C340 380 240 360 200 280" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="200" cy="100" r="8" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M190 100 L180 80 M210 100 L220 80" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "castle",
    title: "Castle",
    category: "fantasy",
    difficulty: "medium",
    thumbnail: "🏰",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <rect x="80" y="160" width="60" height="120" fill="none" stroke="currentColor" stroke-width="4"/>
      <rect x="260" y="160" width="60" height="120" fill="none" stroke="currentColor" stroke-width="4"/>
      <rect x="160" y="180" width="80" height="120" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M70 160 L110 100 L150 160" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M250 160 L290 100 L330 160" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M150 180 L190 120 L230 180" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M60 280 L340 280" fill="none" stroke="currentColor" stroke-width="4"/>
      <rect x="180" y="240" width="40" height="60" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "car",
    title: "Race Car",
    category: "vehicles",
    difficulty: "easy",
    thumbnail: "🏎️",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <path d="M80 220 L120 180 L280 180 L320 220 L320 260 L80 260 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M120 180 L140 140 L260 140 L280 180" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="120" cy="260" r="28" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="280" cy="260" r="28" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="120" cy="260" r="12" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="280" cy="260" r="12" fill="none" stroke="currentColor" stroke-width="4"/>
      <rect x="200" y="150" width="40" height="30" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "tree",
    title: "Oak Tree",
    category: "nature",
    difficulty: "easy",
    thumbnail: "🌳",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <rect x="180" y="280" width="40" height="100" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="200" cy="180" r="80" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="160" cy="160" r="50" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="240" cy="160" r="50" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="200" cy="130" r="50" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="200" cy="220" r="50" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "sunflower",
    title: "Sunflower",
    category: "nature",
    difficulty: "medium",
    thumbnail: "🌻",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <circle cx="200" cy="160" r="40" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="200" cy="100" rx="20" ry="40" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="200" cy="220" rx="20" ry="40" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="140" cy="160" rx="40" ry="20" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="260" cy="160" rx="40" ry="20" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="155" cy="115" rx="25" ry="35" transform="rotate(-45 155 115)" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="245" cy="115" rx="25" ry="35" transform="rotate(45 245 115)" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="155" cy="205" rx="25" ry="35" transform="rotate(45 155 205)" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="245" cy="205" rx="25" ry="35" transform="rotate(-45 245 205)" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 280 L200 360" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 300 Q160 280 150 320" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 320 Q240 300 250 340" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "pumpkin",
    title: "Pumpkin",
    category: "holidays",
    difficulty: "easy",
    thumbnail: "🎃",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="200" cy="230" rx="90" ry="80" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="170" cy="230" rx="50" ry="80" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="230" cy="230" rx="50" ry="80" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 150 L200 120" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M180 190 L220 190 L200 220 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="170" cy="230" r="10" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="230" cy="230" r="10" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M180 260 L200 280 L220 260" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
    </svg>`,
  },
  {
    id: "letter-a",
    title: "Letter A",
    category: "learning",
    difficulty: "easy",
    thumbnail: "🔤",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <path d="M120 320 L200 80 L280 320" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M160 240 L240 240" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="200" cy="80" r="10" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "planet",
    title: "Planet",
    category: "space",
    difficulty: "medium",
    thumbnail: "🪐",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <circle cx="200" cy="200" r="90" fill="none" stroke="currentColor" stroke-width="4"/>
      <ellipse cx="200" cy="200" rx="140" ry="30" fill="none" stroke="currentColor" stroke-width="4" transform="rotate(-20 200 200)"/>
      <circle cx="150" cy="170" r="12" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="240" cy="220" r="8" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="200" cy="150" r="6" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "dragon",
    title: "Baby Dragon",
    category: "fantasy",
    difficulty: "hard",
    thumbnail: "🐉",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="200" cy="220" rx="80" ry="60" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="160" cy="200" r="12" fill="none" stroke="currentColor" stroke-width="4"/>
      <circle cx="240" cy="200" r="12" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M190 220 L210 220 L200 235 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M200 160 L200 120" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M200 120 L160 100 L180 140 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M200 120 L240 100 L220 140 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M280 220 L320 200 L300 240 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M120 220 L80 200 L100 240 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M140 270 Q120 320 180 320" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M260 270 Q280 320 220 320" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "heart",
    title: "Heart",
    category: "holidays",
    difficulty: "easy",
    thumbnail: "❤️",
    svg: `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <path d="M200 320 C80 220 40 140 120 100 C160 80 200 140 200 140 C200 140 240 80 280 100 C360 140 320 220 200 320 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
      <path d="M200 140 L200 220" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M160 180 L200 220 L240 180" fill="none" stroke="currentColor" stroke-width="4"/>
    </svg>`,
  },
];

export default templates;
