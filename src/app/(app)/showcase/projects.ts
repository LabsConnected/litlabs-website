import { Music, BarChart3, Code2 } from "lucide-react";

/**
 * Shared product-demonstration catalog.
 *
 * These are NOT real deployed projects. They are illustrative simulations
 * showing the LiTTree workflow: how a prompt becomes a mission, plan,
 * build steps, and result. No file sizes, durations, deployment URLs, or
 * live results are claimed.
 *
 * Shared by the public /showcase index gallery and the /showcase/[slug]
 * demo pages so both always list the same demos.
 */

export interface DemoProject {
  slug: string;
  title: string;
  prompt: string;
  outcome: string;
  tools: string[];
  icon: typeof Music;
  accent: string;
  steps: { label: string; detail: string }[];
}

export const PROJECTS: Record<string, DemoProject> = {
  "artist-launch-site": {
    slug: "artist-launch-site",
    title: "Artist Launch Site",
    prompt: "Build a premium launch page for an independent music artist named After Midnight with a hero, player, tour dates, and release copy.",
    outcome: "A responsive artist launch page with an embedded music player, release copy, and social integration.",
    tools: ["HTML", "CSS", "JavaScript", "Image Generation", "Audio"],
    icon: Music,
    accent: "#b58cff",
    steps: [
      { label: "Mission created", detail: "LiTT parses the prompt and defines a premium music artist website with 5 sections." },
      { label: "Plan generated", detail: "A 6-step execution plan: hero, layout, player, tour dates, merch, deploy." },
      { label: "Files built", detail: "index.html, styles.css, player.js, and a hero image are created in the workspace." },
      { label: "Preview rendered", detail: "A live preview shows the responsive layout with the music player functioning." },
      { label: "Approved for deployment", detail: "The user reviews the preview and approves deployment preparation." },
      { label: "Ready for deployment", detail: "The production bundle is prepared. The project is ready to ship when the user confirms." },
    ],
  },
  "small-business-dashboard": {
    slug: "small-business-dashboard",
    title: "Small Business Dashboard",
    prompt: "Create a data dashboard for a small business showing sales, inventory, and customer metrics.",
    outcome: "An interactive dashboard with charts, filters, and exportable reports.",
    tools: ["React", "Charts", "Data", "Responsive"],
    icon: BarChart3,
    accent: "#65f4ff",
    steps: [
      { label: "Mission created", detail: "LiTT defines a business dashboard with sales, inventory, and customer panels." },
      { label: "Plan generated", detail: "An 8-step plan: data model, chart components, filters, layout, export, deploy." },
      { label: "Data structure built", detail: "A mock data layer is created with sales, inventory, and customer records." },
      { label: "Chart components built", detail: "Bar, line, and pie chart components are generated with responsive sizing." },
      { label: "Filter system added", detail: "Date range and category filters are connected to the data layer." },
      { label: "Layout assembled", detail: "A grid layout with sidebar navigation and main content area." },
      { label: "Export feature built", detail: "CSV export functionality is added to all report views." },
      { label: "Ready for deployment", detail: "The dashboard is prepared and ready to ship when the user confirms deployment." },
    ],
  },
  "music-campaign": {
    slug: "music-campaign",
    title: "Music Campaign",
    prompt: "Generate cover artwork, promotional copy, and social assets for a single release campaign.",
    outcome: "Cover art, three social posts, and a press kit — all brand-consistent and ready to publish.",
    tools: ["Image Generation", "Copywriting", "Social", "Branding"],
    icon: Code2,
    accent: "#a8ff2f",
    steps: [
      { label: "Mission created", detail: "LiTT defines a single release campaign with cover art, social posts, and press kit." },
      { label: "Plan generated", detail: "A 5-step plan: brand direction, cover art, social copy, social assets, press kit." },
      { label: "Cover art generated", detail: "AI-generated cover artwork in 3 variations. The user selects the final design." },
      { label: "Social copy written", detail: "Promotional copy for 3 social posts with hashtags and call-to-action." },
      { label: "Press kit assembled", detail: "A one-page press kit with artist bio, release info, and downloadable assets." },
    ],
  },
};

export const PROJECT_LIST: DemoProject[] = Object.values(PROJECTS);
