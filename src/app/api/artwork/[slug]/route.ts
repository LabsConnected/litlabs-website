const ARTWORK: Record<
  string,
  { title: string; eyebrow: string; colors: [string, string, string]; motif: string }
> = {
  "neon-city": { title: "Neon Cyber City", eyebrow: "360 WORLD", colors: ["#050816", "#00f0ff", "#ff00a0"], motif: "city" },
  dreamscape: { title: "Ethereal Dreamscape", eyebrow: "ABSTRACT", colors: ["#130726", "#a78bfa", "#22d3ee"], motif: "orbits" },
  "lost-temple": { title: "Lost Temple Ruins", eyebrow: "LANDSCAPE", colors: ["#071711", "#f59e0b", "#34d399"], motif: "temple" },
  "quantum-warrior": { title: "Quantum Warrior", eyebrow: "CHARACTER", colors: ["#080b19", "#fb7185", "#60a5fa"], motif: "prism" },
  "crystal-cavern": { title: "Crystal Cavern", eyebrow: "360 WORLD", colors: ["#071527", "#67e8f9", "#8b5cf6"], motif: "crystal" },
  "void-entity": { title: "Void Entity", eyebrow: "CHARACTER", colors: ["#030308", "#c084fc", "#f43f5e"], motif: "void" },
  underwater: { title: "Underwater Utopia", eyebrow: "360 WORLD", colors: ["#031525", "#38bdf8", "#2dd4bf"], motif: "waves" },
  starfield: { title: "Starfield Station", eyebrow: "LANDSCAPE", colors: ["#030712", "#f8fafc", "#22d3ee"], motif: "stars" },
  pong: { title: "Browser Pong", eyebrow: "RETRO // 2 PLAYERS", colors: ["#05070d", "#22d3ee", "#f8fafc"], motif: "pong" },
  "2048": { title: "2048", eyebrow: "NUMBER PUZZLE", colors: ["#15100b", "#f59e0b", "#fde68a"], motif: "tiles" },
  hextris: { title: "Hextris", eyebrow: "REACTION PUZZLE", colors: ["#0b0716", "#a78bfa", "#22d3ee"], motif: "hex" },
  tetris: { title: "Tetris", eyebrow: "BLOCK PUZZLE", colors: ["#050816", "#f43f5e", "#22d3ee"], motif: "blocks" },
  pacman: { title: "Pac-Man", eyebrow: "ARCADE MAZE", colors: ["#05060a", "#facc15", "#3b82f6"], motif: "maze" },
  snake: { title: "Snake Arcade", eyebrow: "RETRO ARCADE", colors: ["#03120a", "#4ade80", "#bef264"], motif: "snake" },
  sudoku: { title: "Sudoku", eyebrow: "LOGIC PUZZLE", colors: ["#08101d", "#60a5fa", "#f8fafc"], motif: "grid" },
  flappy: { title: "Flappy Bird", eyebrow: "SKILL ARCADE", colors: ["#071827", "#38bdf8", "#facc15"], motif: "flight" },
  minesweeper: { title: "Minesweeper", eyebrow: "LOGIC CLASSIC", colors: ["#101318", "#f87171", "#94a3b8"], motif: "mines" },
};

function motif(name: string, accent: string, secondary: string) {
  const common = `fill="none" stroke="${accent}" stroke-width="5" opacity=".75"`;
  switch (name) {
    case "city": return `<path d="M70 390V210h90v180m25 0V145h115v245m30 0V245h75v145m30 0V175h110v215" ${common}/><path d="M0 390h800" stroke="${secondary}" stroke-width="3"/>`;
    case "temple": return `<path d="M155 360h490M210 190h380l-55-55H265l-55 55Zm45 0v170m95-170v170m100-170v170m95-170v170" ${common}/>`;
    case "crystal": return `<path d="M120 410 250 90l105 320L470 155l105 255 95-210 65 210Z" ${common}/>`;
    case "void": return `<circle cx="400" cy="260" r="150" ${common}/><circle cx="400" cy="260" r="85" stroke="${secondary}" stroke-width="18" opacity=".55"/><circle cx="400" cy="260" r="28" fill="#020205"/>`;
    case "waves": return `<path d="M0 210q100-70 200 0t200 0t200 0t200 0M0 285q100-70 200 0t200 0t200 0t200 0M0 360q100-70 200 0t200 0t200 0t200 0" ${common}/>`;
    case "stars": return `<circle cx="150" cy="130" r="6" fill="${accent}"/><circle cx="600" cy="110" r="8" fill="${secondary}"/><circle cx="520" cy="260" r="4" fill="${accent}"/><circle cx="260" cy="310" r="5" fill="${secondary}"/><path d="M130 380 400 155l270 225Z" ${common}/>`;
    case "pong": return `<path d="M400 80v310" stroke="${secondary}" stroke-width="4" stroke-dasharray="18 18"/><rect x="100" y="170" width="18" height="120" fill="${accent}"/><rect x="682" y="210" width="18" height="120" fill="${accent}"/><circle cx="470" cy="225" r="18" fill="${secondary}"/>`;
    case "tiles": return `<g font-family="system-ui" font-size="46" font-weight="900" text-anchor="middle" fill="${secondary}"><rect x="180" y="105" width="135" height="135" rx="20" ${common}/><text x="248" y="190">2</text><rect x="335" y="105" width="135" height="135" rx="20" ${common}/><text x="403" y="190">0</text><rect x="490" y="105" width="135" height="135" rx="20" ${common}/><text x="558" y="190">4</text><rect x="335" y="260" width="135" height="135" rx="20" ${common}/><text x="403" y="345">8</text></g>`;
    case "hex": return `<path d="m400 85 145 83v168l-145 83-145-83V168Z" ${common}/><path d="m400 150 90 52v104l-90 52-90-52V202Z" stroke="${secondary}" stroke-width="12" fill="none" opacity=".55"/>`;
    case "blocks": return `<g fill="${accent}" opacity=".8"><rect x="180" y="100" width="75" height="75"/><rect x="255" y="100" width="75" height="75"/><rect x="330" y="100" width="75" height="75"/><rect x="330" y="175" width="75" height="75"/><rect x="465" y="250" width="75" height="75"/><rect x="540" y="250" width="75" height="75"/><rect x="390" y="325" width="75" height="75"/><rect x="465" y="325" width="75" height="75"/></g>`;
    case "maze": return `<path d="M140 110h520v280H140V110Zm70 55h155v65H250v95h140m200 0H445v-70h105v-90h-95" ${common}/><circle cx="212" cy="350" r="9" fill="${secondary}"/><circle cx="620" cy="190" r="9" fill="${secondary}"/>`;
    case "snake": return `<path d="M165 150h220v85H250v80h300v-90h90" ${common} stroke-linecap="round" stroke-linejoin="round"/><circle cx="645" cy="225" r="22" fill="${secondary}"/>`;
    case "grid": return `<path d="M230 80v330m110-330v330m110-330v330m110-330v330M120 190h560M120 300h560" ${common}/>`;
    case "flight": return `<path d="M80 330h190V145h110v185h175V100h115v230" ${common}/><path d="m320 220 105-55-35 80 35 80-105-55Z" fill="${secondary}" opacity=".8"/>`;
    case "mines": return `<path d="M180 90v320m110-320v320m110-320v320m110-320v320m110-320v320M125 145h550M125 255h550M125 365h550" ${common}/><circle cx="345" cy="200" r="34" fill="${secondary}" opacity=".8"/><path d="m345 145 12-28m43 43 28-12m-126 12-28-12" stroke="${secondary}" stroke-width="8"/>`;
    default: return `<circle cx="400" cy="250" r="155" ${common}/><path d="m260 330 140-240 140 240Z" stroke="${secondary}" stroke-width="9" fill="none" opacity=".55"/>`;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const art = ARTWORK[slug] || ARTWORK.dreamscape;
  const [background, accent, secondary] = art.colors;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" role="img" aria-label="${art.title}">
    <defs><radialGradient id="g" cx="75%" cy="20%" r="90%"><stop stop-color="${accent}" stop-opacity=".34"/><stop offset=".55" stop-color="${secondary}" stop-opacity=".12"/><stop offset="1" stop-color="${background}"/></radialGradient><pattern id="grid" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0v38" fill="none" stroke="${accent}" stroke-opacity=".08"/></pattern></defs>
    <rect width="800" height="600" fill="${background}"/><rect width="800" height="600" fill="url(#g)"/><rect width="800" height="600" fill="url(#grid)"/>
    ${motif(art.motif, accent, secondary)}
    <rect x="42" y="450" width="716" height="108" rx="22" fill="${background}" fill-opacity=".84" stroke="${accent}" stroke-opacity=".3"/>
    <text x="72" y="493" fill="${accent}" font-family="system-ui,sans-serif" font-size="16" font-weight="800" letter-spacing="4">${art.eyebrow}</text>
    <text x="72" y="535" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="34" font-weight="900">${art.title}</text>
  </svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
