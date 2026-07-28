/**
 * Fun Layer v1 — Creative Challenge Catalog
 *
 * Typed challenge definitions for the Daily Challenge and Surprise Me features.
 * Challenges are deterministic (UTC date-based selection) and do not claim
 * XP, rewards, unlocks, streaks, or balances.
 */

import type { ThemeId } from "./themes";

export type ChallengeCategory =
  | "weird-build"
  | "impossible-product"
  | "visual-remix"
  | "fake-game"
  | "cinematic-scene"
  | "design-rescue"
  | "spark-wildcard";

export type ChallengeDifficulty = "easy" | "medium" | "wild";

export type ChallengeTool = "code" | "image" | "video" | "audio";

export interface CreativeChallenge {
  id: string;
  title: string;
  objective: string;
  category: ChallengeCategory;
  difficulty: ChallengeDifficulty;
  suggestedTool: ChallengeTool;
  starterPrompt: string;
  visualTheme: ThemeId;
}

export const CHALLENGES: CreativeChallenge[] = [
  // ── weird-build ──
  {
    id: "weird-landing-nonexistent",
    title: "Landing Page for a Product That Should Not Exist",
    objective: "Design and build a landing page for a product so absurd it could never ship.",
    category: "weird-build",
    difficulty: "easy",
    suggestedTool: "code",
    starterPrompt: "Build a landing page for a product called 'Air Guitar Tuner Pro' — a device that tunes air guitars using AI. Include a hero section, three feature cards, and a fake pricing table. Make it look completely serious.",
    visualTheme: "neon-ember",
  },
  {
    id: "weird-form-chaos",
    title: "The World's Most Aggressive Form",
    objective: "Create a sign-up form that has opinions about your answers.",
    category: "weird-build",
    difficulty: "medium",
    suggestedTool: "code",
    starterPrompt: "Build a sign-up form that judges each field as you type. The email field should complain if it looks boring. The password field should rate your password like a movie review. Keep it functional but ridiculous.",
    visualTheme: "toxic-arcade",
  },
  {
    id: "weird-404-village",
    title: "404 Page That Is an Entire Village",
    objective: "Turn an error page into a tiny explorable world.",
    category: "weird-build",
    difficulty: "wild",
    suggestedTool: "code",
    starterPrompt: "Build a 404 page that renders a small isometric village made of CSS. Each building is a link to a real page. Hovering a building shows its name. The village should feel alive even though it is an error state.",
    visualTheme: "ghost-circuit",
  },

  // ── impossible-product ──
  {
    id: "impossible-time-shoe",
    title: "A Shoe That Tells Time",
    objective: "Pitch and prototype a product that defies physics.",
    category: "impossible-product",
    difficulty: "medium",
    suggestedTool: "image",
    starterPrompt: "Design a product mockup for 'ChronoSole' — a sneaker with a working analog clock embedded in the sole. Create a hero product shot and a feature diagram showing how the clock mechanism survives walking.",
    visualTheme: "solar-flare",
  },
  {
    id: "impossible-edible-cloud",
    title: "Edible Cloud Storage",
    objective: "Design packaging and brand for a product that cannot exist.",
    category: "impossible-product",
    difficulty: "wild",
    suggestedTool: "image",
    starterPrompt: "Create a brand identity and product packaging for 'Nimbus Bite' — a cloud storage service where your files are stored in edible cotton candy. Design the box, the logo, and a single ad banner.",
    visualTheme: "cyber-forest",
  },
  {
    id: "impossible-reverse-microwave",
    title: "Reverse Microwave Interface",
    objective: "Design the control panel for a device that un-cooks food.",
    category: "impossible-product",
    difficulty: "easy",
    suggestedTool: "code",
    starterPrompt: "Build the touch-screen interface for a 'FrostWave' reverse microwave. It should have temperature dials, a timer, and preset buttons like 'Unfry', 'Defrost Pizza', and 'Reverse Bake'. Make the UI feel like a real appliance.",
    visualTheme: "midnight-lab",
  },

  // ── visual-remix ──
  {
    id: "remix-cyberpunk-nature",
    title: "Cyberpunk Meets National Park",
    objective: "Merge two visual languages that have no business being together.",
    category: "visual-remix",
    difficulty: "medium",
    suggestedTool: "image",
    starterPrompt: "Generate an image that blends cyberpunk neon aesthetics with a pristine national park landscape. Think holographic signs over waterfalls, neon trails through redwood forests, and chrome wildlife.",
    visualTheme: "neon-ember",
  },
  {
    id: "remix-vaporwave-medieval",
    title: "Vaporwave Castle",
    objective: "Remix two eras into a single coherent image.",
    category: "visual-remix",
    difficulty: "easy",
    suggestedTool: "image",
    starterPrompt: "Generate an image of a medieval castle rendered in full vaporwave aesthetic — pink and purple gradients, Greek statues in the courtyard, a grid floor, and a sunset that is also a VHS glitch.",
    visualTheme: "solar-flare",
  },
  {
    id: "remix-brutalist-kawaii",
    title: "Brutalist Kawaii Dashboard",
    objective: "Combine harsh minimalism with overwhelming cuteness.",
    category: "visual-remix",
    difficulty: "wild",
    suggestedTool: "code",
    starterPrompt: "Build a dashboard UI that is simultaneously brutalist (raw concrete textures, monospace fonts, zero border-radius) and kawaii (pastel colors, rounded mascots, sparkles). The contrast should be jarring but functional.",
    visualTheme: "toxic-arcade",
  },

  // ── fake-game ──
  {
    id: "fake-game-quietest",
    title: "The Quietest Game Ever",
    objective: "Design a game where silence is the core mechanic.",
    category: "fake-game",
    difficulty: "medium",
    suggestedTool: "code",
    starterPrompt: "Build a browser game called 'Whisper' where you navigate a dark maze using only sound cues. There is no visual map — you hear footsteps, echoes, and distant sounds to find the exit. Include a start screen and one level.",
    visualTheme: "ghost-circuit",
  },
  {
    id: "fake-game-bureaucracy",
    title: "Bureaucracy Simulator 2026",
    objective: "Make paperwork genuinely fun.",
    category: "fake-game",
    difficulty: "wild",
    suggestedTool: "code",
    starterPrompt: "Build a browser game where you fill out increasingly absurd forms under a time limit. Each form has one impossible field. The game tracks how many forms you 'completed' before giving up. Include a score screen.",
    visualTheme: "midnight-lab",
  },
  {
    id: "fake-game-one-button",
    title: "One-Button Epic",
    objective: "Design a complete game experience using a single input.",
    category: "fake-game",
    difficulty: "easy",
    suggestedTool: "code",
    starterPrompt: "Build a browser game controlled entirely by the spacebar. The single button must handle jumping, attacking, and menu navigation. Include at least one level, a win condition, and a lose condition.",
    visualTheme: "toxic-arcade",
  },

  // ── cinematic-scene ──
  {
    id: "cinematic-last-frame",
    title: "The Last Frame of a Movie That Doesn't Exist",
    objective: "Generate an image that tells a complete story in one frame.",
    category: "cinematic-scene",
    difficulty: "medium",
    suggestedTool: "image",
    starterPrompt: "Generate the final frame of a sci-fi film called 'The Last Signal'. It should show a lone figure at a derelict communications tower on an alien world, with a single light still blinking. The composition should feel like an ending.",
    visualTheme: "cyber-forest",
  },
  {
    id: "cinematic-city-waking",
    title: "A City Waking Up in 10 Seconds",
    objective: "Create a short video that captures a full morning in seconds.",
    category: "cinematic-scene",
    difficulty: "wild",
    suggestedTool: "video",
    starterPrompt: "Generate a 10-second video showing a neon-lit city transitioning from 3 AM silence to 7 AM chaos. The camera should be fixed. The only movement is light, traffic, and people appearing.",
    visualTheme: "neon-ember",
  },
  {
    id: "cinematic-product-launch",
    title: "Fake Product Launch Ad",
    objective: "Direct a 15-second ad for a product that does not exist.",
    category: "cinematic-scene",
    difficulty: "medium",
    suggestedTool: "video",
    starterPrompt: "Generate a 15-second product launch video for 'Lumen' — a wearable light orb that follows you home. The ad should have a hero shot, a lifestyle shot, and a logo reveal. No voiceover needed.",
    visualTheme: "solar-flare",
  },

  // ── design-rescue ──
  {
    id: "rescue-ugly-dashboard",
    title: "Rescue the Ugliest Dashboard",
    objective: "Take a deliberately bad UI and make it beautiful without changing the layout.",
    category: "design-rescue",
    difficulty: "easy",
    suggestedTool: "code",
    starterPrompt: "Build a dashboard that starts visually broken — clashing colors, mismatched fonts, no spacing. Then add a 'Fix It' button that applies a clean design system transformation while keeping the exact same layout and content.",
    visualTheme: "midnight-lab",
  },
  {
    id: "rescue-bad-landing",
    title: "Fix a Landing Page in 5 Changes",
    objective: "Improve a landing page with exactly five design decisions.",
    category: "design-rescue",
    difficulty: "medium",
    suggestedTool: "code",
    starterPrompt: "Build a deliberately mediocre landing page. Then create a side panel that lets you toggle exactly five design improvements: typography, color, spacing, imagery, and motion. Each toggle should show a clear before/after.",
    visualTheme: "neon-ember",
  },
  {
    id: "rescue-form-pain",
    title: "Make a Painful Form Painless",
    objective: "Redesign a form that currently feels like a tax return.",
    category: "design-rescue",
    difficulty: "easy",
    suggestedTool: "code",
    starterPrompt: "Build a long, ugly registration form with 12 fields, no grouping, and no feedback. Then redesign it into a clean, single-column, progressively disclosed form with smart defaults and inline validation. Show both versions side by side.",
    visualTheme: "ghost-circuit",
  },

  // ── spark-wildcard ──
  {
    id: "spark-give-spark-control",
    title: "Give Spark Full Control",
    objective: "Let the AI agent choose what to build with no constraints.",
    category: "spark-wildcard",
    difficulty: "wild",
    suggestedTool: "code",
    starterPrompt: "Open the Studio chat tool and tell Spark: 'Build whatever you want. Surprise me. The only rule is it must be interactive and run in the browser.' Then see what happens.",
    visualTheme: "neon-ember",
  },
  {
    id: "spark-mystery-challenge",
    title: "Mystery Challenge",
    objective: "A random challenge you will not see coming.",
    category: "spark-wildcard",
    difficulty: "wild",
    suggestedTool: "code",
    starterPrompt: "Open the Studio chat tool and ask Spark to generate a random creative prompt for you right now. Whatever it says, build it immediately. Do not overthink it.",
    visualTheme: "toxic-arcade",
  },
  {
    id: "spark-fix-something-ugly",
    title: "Fix Something Ugly in Your Life",
    objective: "Pick something visually broken around you and redesign it.",
    category: "spark-wildcard",
    difficulty: "easy",
    suggestedTool: "image",
    starterPrompt: "Think of the ugliest digital thing you saw today — a bad app icon, a terrible poster, a broken email. Recreate it in the image tool, then generate a redesigned version that is actually beautiful.",
    visualTheme: "solar-flare",
  },
];

export const CHALLENGE_MAP: Record<string, CreativeChallenge> = Object.fromEntries(
  CHALLENGES.map((c) => [c.id, c]),
);

export function getChallengeById(id: string): CreativeChallenge | undefined {
  return CHALLENGE_MAP[id];
}
