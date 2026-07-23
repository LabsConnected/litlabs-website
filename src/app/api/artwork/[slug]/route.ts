type ArtworkDef = {
  title: string;
  eyebrow: string;
  bg: string;
  accent: string;
  secondary: string;
  tertiary: string;
  motif: string;
};

const ARTWORK: Record<string, ArtworkDef> = {
  "neon-city": { title: "Neon Cyber City", eyebrow: "360 WORLD", bg: "#050816", accent: "#00f0ff", secondary: "#ff00a0", tertiary: "#7c3aed", motif: "city" },
  dreamscape: { title: "Ethereal Dreamscape", eyebrow: "ABSTRACT", bg: "#130726", accent: "#a78bfa", secondary: "#22d3ee", tertiary: "#f472b6", motif: "orbits" },
  "lost-temple": { title: "Lost Temple Ruins", eyebrow: "LANDSCAPE", bg: "#071711", accent: "#f59e0b", secondary: "#34d399", tertiary: "#b45309", motif: "temple" },
  "quantum-warrior": { title: "Quantum Warrior", eyebrow: "CHARACTER", bg: "#080b19", accent: "#fb7185", secondary: "#60a5fa", tertiary: "#c084fc", motif: "prism" },
  "crystal-cavern": { title: "Crystal Cavern", eyebrow: "360 WORLD", bg: "#071527", accent: "#67e8f9", secondary: "#8b5cf6", tertiary: "#22d3ee", motif: "crystal" },
  "void-entity": { title: "Void Entity", eyebrow: "CHARACTER", bg: "#030308", accent: "#c084fc", secondary: "#f43f5e", tertiary: "#6366f1", motif: "void" },
  underwater: { title: "Underwater Utopia", eyebrow: "360 WORLD", bg: "#031525", accent: "#38bdf8", secondary: "#2dd4bf", tertiary: "#0ea5e9", motif: "waves" },
  starfield: { title: "Starfield Station", eyebrow: "LANDSCAPE", bg: "#030712", accent: "#f8fafc", secondary: "#22d3ee", tertiary: "#818cf8", motif: "stars" },
  pong: { title: "Browser Pong", eyebrow: "RETRO // 2P", bg: "#040814", accent: "#22d3ee", secondary: "#f8fafc", tertiary: "#0ea5e9", motif: "pong" },
  "2048": { title: "2048", eyebrow: "NUMBER PUZZLE", bg: "#15100b", accent: "#f59e0b", secondary: "#fde68a", tertiary: "#d97706", motif: "tiles" },
  hextris: { title: "Hextris", eyebrow: "REACTION PUZZLE", bg: "#0b0716", accent: "#a78bfa", secondary: "#22d3ee", tertiary: "#8b5cf6", motif: "hex" },
  tetris: { title: "Tetris", eyebrow: "BLOCK PUZZLE", bg: "#050816", accent: "#f43f5e", secondary: "#22d3ee", tertiary: "#facc15", motif: "blocks" },
  pacman: { title: "Pac-Man", eyebrow: "ARCADE MAZE", bg: "#05060a", accent: "#facc15", secondary: "#3b82f6", tertiary: "#ef4444", motif: "maze" },
  snake: { title: "Snake Arcade", eyebrow: "RETRO ARCADE", bg: "#03120a", accent: "#4ade80", secondary: "#bef264", tertiary: "#22c55e", motif: "snake" },
  sudoku: { title: "Sudoku", eyebrow: "LOGIC PUZZLE", bg: "#08101d", accent: "#60a5fa", secondary: "#f8fafc", tertiary: "#3b82f6", motif: "grid" },
  flappy: { title: "Flappy Bird", eyebrow: "SKILL ARCADE", bg: "#071827", accent: "#38bdf8", secondary: "#facc15", tertiary: "#0ea5e9", motif: "flight" },
  minesweeper: { title: "Minesweeper", eyebrow: "LOGIC CLASSIC", bg: "#0d1117", accent: "#f87171", secondary: "#94a3b8", tertiary: "#fbbf24", motif: "mines" },
};

function motif(name: string, a: string, b: string, c: string) {
  const sw = (w: number, op = ".8") => `fill="none" stroke="${a}" stroke-width="${w}" opacity="${op}"`;
  const sw2 = (w: number, op = ".6") => `fill="none" stroke="${b}" stroke-width="${w}" opacity="${op}"`;
  switch (name) {
    case "city":
      return `<path d="M60 400V220h80v180m20 0V160h100v240m25 0V250h60v150m25 0V190h95v210m25 0V140h80v260" ${sw(4)}/><rect x="75" y="235" width="8" height="8" fill="${a}" opacity=".5"/><rect x="95" y="250" width="8" height="8" fill="${a}" opacity=".4"/><rect x="175" y="175" width="8" height="8" fill="${b}" opacity=".5"/><rect x="195" y="195" width="8" height="8" fill="${a}" opacity=".4"/><rect x="175" y="215" width="8" height="8" fill="${a}" opacity=".3"/><rect x="320" y="265" width="8" height="8" fill="${a}" opacity=".4"/><rect x="340" y="280" width="8" height="8" fill="${b}" opacity=".3"/><rect x="430" y="205" width="8" height="8" fill="${a}" opacity=".5"/><rect x="450" y="225" width="8" height="8" fill="${a}" opacity=".3"/><rect x="560" y="155" width="8" height="8" fill="${b}" opacity=".5"/><rect x="580" y="175" width="8" height="8" fill="${a}" opacity=".4"/><path d="M0 400h800" stroke="${b}" stroke-width="2" opacity=".4"/><path d="M0 405h800" stroke="${a}" stroke-width="1" opacity=".2"/>`;
    case "temple":
      return `<path d="M155 370h490M210 200h380l-55-55H265l-55 55Z" ${sw(4)}/><path d="M255 370v160m95-160v160m100-160v160m95-160v160" ${sw(3)}/><circle cx="400" cy="170" r="12" fill="${a}" opacity=".6"/><path d="M280 250h240" ${sw2(2)}/><rect x="370" y="280" width="60" height="90" ${sw2(3)}/>`;
    case "crystal":
      return `<path d="M120 420 250 90l105 330L470 155l105 255 95-210 65 210Z" ${sw(4)}/><path d="M250 90 355 420" ${sw2(2)}/><path d="M470 155 575 410" ${sw2(2)}/><circle cx="250" cy="90" r="6" fill="${a}"/><circle cx="470" cy="155" r="6" fill="${b}"/>`;
    case "void":
      return `<circle cx="400" cy="260" r="160" ${sw(4)}/><circle cx="400" cy="260" r="110" ${sw2(16, ".4")}/><circle cx="400" cy="260" r="60" fill="${a}" opacity=".15"/><circle cx="400" cy="260" r="30" fill="#020205"/><circle cx="400" cy="260" r="45" ${sw2(2, ".3")}/>`;
    case "waves":
      return `<path d="M0 200q100-70 200 0t200 0t200 0t200 0M0 280q100-70 200 0t200 0t200 0t200 0M0 360q100-70 200 0t200 0t200 0t200 0" ${sw(4)}/><path d="M0 240q100-70 200 0t200 0t200 0t200 0M0 320q100-70 200 0t200 0t200 0t200 0" ${sw2(3, ".4")}/>`;
    case "stars":
      return `<circle cx="150" cy="130" r="7" fill="${a}"/><circle cx="600" cy="110" r="9" fill="${b}"/><circle cx="520" cy="260" r="5" fill="${a}"/><circle cx="260" cy="310" r="6" fill="${b}"/><circle cx="420" cy="180" r="3" fill="${a}" opacity=".5"/><circle cx="700" cy="320" r="4" fill="${b}" opacity=".5"/><path d="M130 380 400 155l270 225Z" ${sw(4)}/><path d="M400 155 400 380" ${sw2(2, ".3")}/>`;
    case "pong":
      return `<path d="M400 60v340" stroke="${b}" stroke-width="3" stroke-dasharray="14 14" opacity=".4"/><rect x="90" y="160" width="20" height="130" rx="4" fill="${a}"/><rect x="90" y="160" width="20" height="130" rx="4" fill="url(#glow)"/><rect x="690" y="210" width="20" height="130" rx="4" fill="${a}"/><rect x="690" y="210" width="20" height="130" rx="4" fill="url(#glow)"/><circle cx="460" cy="220" r="20" fill="${b}"/><circle cx="460" cy="220" r="28" fill="url(#glow)"/><rect x="86" y="156" width="28" height="138" rx="6" fill="none" stroke="${a}" stroke-width="1" opacity=".3"/><rect x="686" y="206" width="28" height="138" rx="6" fill="none" stroke="${a}" stroke-width="1" opacity=".3"/>`;
    case "tiles":
      return `<g font-family="system-ui" font-size="52" font-weight="900" text-anchor="middle"><rect x="170" y="100" width="140" height="140" rx="18" fill="${a}" opacity=".15" stroke="${a}" stroke-width="3"/><text x="240" y="188" fill="${b}">2</text><rect x="330" y="100" width="140" height="140" rx="18" fill="${a}" opacity=".2" stroke="${a}" stroke-width="3"/><text x="400" y="188" fill="${b}">0</text><rect x="490" y="100" width="140" height="140" rx="18" fill="${a}" opacity=".25" stroke="${a}" stroke-width="3"/><text x="560" y="188" fill="${b}">4</text><rect x="330" y="260" width="140" height="140" rx="18" fill="${a}" opacity=".3" stroke="${a}" stroke-width="3"/><text x="400" y="348" fill="${b}">8</text><rect x="490" y="260" width="140" height="140" rx="18" fill="${a}" opacity=".12" stroke="${a}" stroke-width="2"/><text x="560" y="348" fill="${b}" opacity=".3">16</text></g>`;
    case "hex":
      return `<path d="m400 80 155 90v180l-155 90-155-90V170Z" ${sw(4)}/><path d="m400 145 95 55v110l-95 55-95-55V200Z" ${sw2(10, ".4")}/><path d="m400 210 50 29v58l-50 29-50-29v-58Z" fill="${a}" opacity=".1" stroke="${a}" stroke-width="2" opacity=".5"/><circle cx="400" cy="80" r="5" fill="${a}"/><circle cx="555" cy="170" r="5" fill="${b}"/><circle cx="555" cy="350" r="5" fill="${a}"/><circle cx="400" cy="440" r="5" fill="${b}"/><circle cx="245" cy="350" r="5" fill="${a}"/><circle cx="245" cy="170" r="5" fill="${b}"/>`;
    case "blocks":
      return `<g><rect x="170" y="90" width="80" height="80" rx="6" fill="${a}" opacity=".85"/><rect x="250" y="90" width="80" height="80" rx="6" fill="${b}" opacity=".85"/><rect x="330" y="90" width="80" height="80" rx="6" fill="${c}" opacity=".85"/><rect x="330" y="170" width="80" height="80" rx="6" fill="${a}" opacity=".7"/><rect x="410" y="170" width="80" height="80" rx="6" fill="${b}" opacity=".7"/><rect x="490" y="250" width="80" height="80" rx="6" fill="${c}" opacity=".85"/><rect x="570" y="250" width="80" height="80" rx="6" fill="${a}" opacity=".7"/><rect x="410" y="330" width="80" height="80" rx="6" fill="${b}" opacity=".85"/><rect x="490" y="330" width="80" height="80" rx="6" fill="${c}" opacity=".6"/><rect x="250" y="250" width="80" height="80" rx="6" fill="${a}" opacity=".4" stroke="${a}" stroke-width="2" opacity=".3"/><rect x="170" y="330" width="80" height="80" rx="6" fill="${b}" opacity=".3" stroke="${b}" stroke-width="2" opacity=".2"/></g>`;
    case "maze":
      return `<path d="M140 100h520v300H140V100Z" ${sw(4)}/><path d="M200 155h140v60H250v80h120m180 0H440v-60h100v-80h-80" ${sw(3)}/><path d="M200 155v245M340 155v60M250 215v80M370 295v150M440 235v60M540 175v80M460 175v-20" ${sw2(2, ".4")}/><circle cx="215" cy="370" r="11" fill="${a}"/><circle cx="215" cy="370" r="18" fill="${a}" opacity=".2"/><circle cx="620" cy="180" r="8" fill="${b}"/><circle cx="620" cy="180" r="14" fill="${b}" opacity=".2"/><circle cx="620" cy="180" r="5" fill="${c}" opacity=".8"/>`;
    case "snake":
      return `<path d="M150 160h200v80H230v70h280v-80h90" ${sw(6)} stroke-linecap="round" stroke-linejoin="round"/><path d="M150 160h200v80H230v70h280v-80h90" ${sw2(12, ".2")} stroke-linecap="round" stroke-linejoin="round"/><circle cx="640" cy="230" r="24" fill="${b}"/><circle cx="640" cy="230" r="32" fill="${b}" opacity=".15"/><circle cx="648" cy="225" r="4" fill="#0a1a0a"/><path d="M655 240l15-5" stroke="#0a1a0a" stroke-width="3" stroke-linecap="round"/>`;
    case "grid":
      return `<path d="M230 70v340m100-340v340m100-340v340m100-340v340M130 170h540M130 280h540M130 390h540" ${sw(3, ".6")}/><rect x="230" y="170" width="100" height="110" fill="${a}" opacity=".08"/><rect x="430" y="280" width="100" height="110" fill="${a}" opacity=".08"/><text x="265" y="225" font-family="system-ui" font-size="28" font-weight="900" fill="${a}" opacity=".5">5</text><text x="465" y="335" font-family="system-ui" font-size="28" font-weight="900" fill="${a}" opacity=".5">3</text><text x="365" y="225" font-family="system-ui" font-size="28" font-weight="900" fill="${b}" opacity=".4">7</text><text x="565" y="225" font-family="system-ui" font-size="28" font-weight="900" fill="${b}" opacity=".3">1</text>`;
    case "flight":
      return `<path d="M70 340h180V150h100v190h170V110h100v230" ${sw(4)}/><path d="M70 340h180V150h100v190h170V110h100v230" ${sw2(8, ".15")}/><path d="m310 225 100-50-30 75 30 75-100-50Z" fill="${b}" opacity=".85"/><path d="m310 225 100-50-30 75 30 75-100-50Z" fill="none" stroke="${a}" stroke-width="2" opacity=".5"/><circle cx="400" cy="225" r="8" fill="${a}"/><path d="M50 350h700" stroke="${a}" stroke-width="2" opacity=".2"/>`;
    case "mines":
      return `<path d="M170 80v340m100-340v340m100-340v340m100-340v340m100-340v340M120 140h560M120 250h560M120 360h560" ${sw(3, ".5")}/><rect x="170" y="140" width="100" height="110" fill="${a}" opacity=".06"/><rect x="370" y="140" width="100" height="110" fill="${a}" opacity=".06"/><rect x="270" y="250" width="100" height="110" fill="${a}" opacity=".06"/><rect x="470" y="250" width="100" height="110" fill="${a}" opacity=".06"/><circle cx="420" cy="195" r="36" fill="${a}" opacity=".85"/><circle cx="420" cy="195" r="48" fill="${a}" opacity=".15"/><path d="m420 140 12-30m45 45 30-12m-135 12-30-12m150 75 30 12m-165-12-30 12" stroke="${b}" stroke-width="4" opacity=".6"/><circle cx="420" cy="195" r="6" fill="${c}"/>`;
    default:
      return `<circle cx="400" cy="250" r="155" ${sw(4)}/><path d="m260 330 140-240 140 240Z" ${sw2(9, ".5")}/>`;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const art = ARTWORK[slug] || ARTWORK.dreamscape;
  const { bg, accent, secondary, tertiary } = art;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" role="img" aria-label="${art.title}">
  <defs>
    <radialGradient id="g1" cx="72%" cy="18%" r="85%">
      <stop stop-color="${accent}" stop-opacity=".35"/>
      <stop offset=".5" stop-color="${tertiary}" stop-opacity=".15"/>
      <stop offset="1" stop-color="${bg}"/>
    </radialGradient>
    <radialGradient id="g2" cx="20%" cy="85%" r="70%">
      <stop stop-color="${secondary}" stop-opacity=".18"/>
      <stop offset="1" stop-color="${bg}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop stop-color="${accent}" stop-opacity=".6"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop stop-color="${bg}" stop-opacity="0"/>
      <stop offset=".6" stop-color="${bg}" stop-opacity=".6"/>
      <stop offset="1" stop-color="${bg}" stop-opacity=".95"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0v40" fill="none" stroke="${accent}" stroke-opacity=".06"/>
    </pattern>
    <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="14" cy="14" r="1.2" fill="${accent}" opacity=".08"/>
    </pattern>
    <filter id="blur"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <rect width="800" height="600" fill="${bg}"/>
  <rect width="800" height="600" fill="url(#g1)"/>
  <rect width="800" height="600" fill="url(#g2)"/>
  <rect width="800" height="600" fill="url(#grid)"/>
  <rect width="800" height="600" fill="url(#dots)"/>
  ${motif(art.motif, accent, secondary, tertiary)}
  <rect width="800" height="600" fill="url(#bottomFade)"/>
  <rect x="0" y="440" width="800" height="160" fill="${bg}" fill-opacity=".7"/>
  <rect x="0" y="438" width="800" height="2" fill="${accent}" opacity=".3"/>
  <rect x="48" y="462" width="4" height="84" rx="2" fill="${accent}"/>
  <text x="68" y="492" fill="${accent}" font-family="system-ui,sans-serif" font-size="14" font-weight="800" letter-spacing="4.5">${art.eyebrow}</text>
  <text x="68" y="528" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="32" font-weight="900">${art.title}</text>
  <text x="750" y="528" fill="${accent}" font-family="system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="2" opacity=".5" text-anchor="end">LiTTree</text>
  <rect x="0" y="0" width="800" height="600" fill="none" stroke="${accent}" stroke-width="1" opacity=".08"/>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
