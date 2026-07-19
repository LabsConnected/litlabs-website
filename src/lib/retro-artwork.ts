import type { RetroSystemId } from "./retro-arcade";

export type ArtworkRatio = "cover" | "hero" | "icon";

export interface ArtworkConfig {
  system: RetroSystemId;
  title: string;
  subtitle?: string;
  accent?: string;
  ratio: ArtworkRatio;
}

const SYSTEM_PALETTE: Record<
  RetroSystemId,
  { bg: string; accent: string; secondary: string; label: string; cartridge: string }
> = {
  nes: {
    bg: "#1a1020",
    accent: "#ff4d67",
    secondary: "#f8fafc",
    label: "#d4364a",
    cartridge: "#c8c8d0",
  },
  snes: {
    bg: "#1c1428",
    accent: "#a78bfa",
    secondary: "#22d3ee",
    label: "#7c5cbf",
    cartridge: "#b0b0c0",
  },
  gb: {
    bg: "#0f1a0a",
    accent: "#a3e635",
    secondary: "#f8fafc",
    label: "#5a7a2a",
    cartridge: "#d0d0d4",
  },
  gbc: {
    bg: "#1a1408",
    accent: "#fbbf24",
    secondary: "#f472b6",
    label: "#d97706",
    cartridge: "#9ad4d0",
  },
  gba: {
    bg: "#0a1420",
    accent: "#38bdf8",
    secondary: "#818cf8",
    label: "#1e6ba8",
    cartridge: "#5a5a6a",
  },
  segaMD: {
    bg: "#0a0a0f",
    accent: "#22d3ee",
    secondary: "#f59e0b",
    label: "#1a1a2e",
    cartridge: "#1a1a1a",
  },
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "\u2026";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface Dimensions {
  width: number;
  height: number;
  viewBox: string;
}

function getDimensions(ratio: ArtworkRatio): Dimensions {
  switch (ratio) {
    case "cover":
      return { width: 300, height: 400, viewBox: "0 0 300 400" };
    case "hero":
      return { width: 800, height: 450, viewBox: "0 0 800 450" };
    case "icon":
      return { width: 120, height: 120, viewBox: "0 0 120 120" };
  }
}

function buildCartridge(
  system: RetroSystemId,
  palette: (typeof SYSTEM_PALETTE)[RetroSystemId],
  title: string,
  subtitle: string | undefined,
  w: number,
  h: number,
): string {
  const safeTitle = escapeXml(truncate(title, 28));
  const safeSubtitle = escapeXml(truncate(subtitle ?? "", 32));

  switch (system) {
    case "nes": {
      const cartTop = h * 0.08;
      const cartBottom = h * 0.92;
      const cartLeft = w * 0.12;
      const cartRight = w * 0.88;
      const cartW = cartRight - cartLeft;
      const cartH = cartBottom - cartTop;
      const labelTop = cartTop + cartH * 0.15;
      const labelH = cartH * 0.55;
      return `
        <rect x="${cartLeft}" y="${cartTop}" width="${cartW}" height="${cartH}" rx="6" fill="${palette.cartridge}" stroke="#999" stroke-width="1.5"/>
        <rect x="${cartLeft + cartW * 0.06}" y="${labelTop}" width="${cartW * 0.88}" height="${labelH}" rx="3" fill="${palette.label}"/>
        <rect x="${cartLeft + cartW * 0.06}" y="${labelTop}" width="${cartW * 0.88}" height="${labelH * 0.12}" rx="3" fill="${palette.accent}" opacity=".8"/>
        <text x="${w / 2}" y="${labelTop + labelH * 0.4}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.09, 22)}" font-weight="900">${safeTitle}</text>
        ${safeSubtitle ? `<text x="${w / 2}" y="${labelTop + labelH * 0.58}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.05, 12)}" font-weight="600" opacity=".8">${safeSubtitle}</text>` : ""}
        <rect x="${cartLeft + cartW * 0.3}" y="${cartBottom - cartH * 0.12}" width="${cartW * 0.4}" height="${cartH * 0.06}" rx="2" fill="#888"/>
        <text x="${w / 2}" y="${cartBottom - cartH * 0.04}" text-anchor="middle" fill="#666" font-family="system-ui,sans-serif" font-size="8" font-weight="700" letter-spacing="2">NES</text>
      `;
    }
    case "snes": {
      const cartTop = h * 0.06;
      const cartBottom = h * 0.94;
      const cartLeft = w * 0.1;
      const cartRight = w * 0.9;
      const cartW = cartRight - cartLeft;
      const cartH = cartBottom - cartTop;
      const labelTop = cartTop + cartH * 0.12;
      const labelH = cartH * 0.6;
      return `
        <rect x="${cartLeft}" y="${cartTop}" width="${cartW}" height="${cartH}" rx="8" fill="${palette.cartridge}" stroke="#aaa" stroke-width="1.5"/>
        <rect x="${cartLeft + cartW * 0.05}" y="${labelTop}" width="${cartW * 0.9}" height="${labelH}" rx="4" fill="${palette.label}"/>
        <rect x="${cartLeft + cartW * 0.05}" y="${labelTop}" width="${cartW * 0.9}" height="${labelH * 0.08}" rx="4" fill="${palette.accent}"/>
        <rect x="${cartLeft + cartW * 0.05}" y="${labelTop + labelH * 0.08}" width="${cartW * 0.9}" height="${labelH * 0.04}" fill="${palette.secondary}" opacity=".4"/>
        <text x="${w / 2}" y="${labelTop + labelH * 0.42}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.09, 22)}" font-weight="900">${safeTitle}</text>
        ${safeSubtitle ? `<text x="${w / 2}" y="${labelTop + labelH * 0.6}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.05, 12)}" font-weight="600" opacity=".8">${safeSubtitle}</text>` : ""}
        <circle cx="${cartLeft + cartW * 0.15}" cy="${cartBottom - cartH * 0.1}" r="${cartW * 0.04}" fill="#666"/>
        <circle cx="${cartRight - cartW * 0.15}" cy="${cartBottom - cartH * 0.1}" r="${cartW * 0.04}" fill="#666"/>
        <text x="${w / 2}" y="${cartBottom - cartH * 0.03}" text-anchor="middle" fill="#888" font-family="system-ui,sans-serif" font-size="8" font-weight="700" letter-spacing="2">SUPER NINTENDO</text>
      `;
    }
    case "gb": {
      const cartTop = h * 0.1;
      const cartBottom = h * 0.9;
      const cartLeft = w * 0.14;
      const cartRight = w * 0.86;
      const cartW = cartRight - cartLeft;
      const cartH = cartBottom - cartTop;
      const labelTop = cartTop + cartH * 0.2;
      const labelH = cartH * 0.5;
      return `
        <rect x="${cartLeft}" y="${cartTop}" width="${cartW}" height="${cartH}" rx="4" fill="${palette.cartridge}" stroke="#aaa" stroke-width="1"/>
        <rect x="${cartLeft + cartW * 0.08}" y="${labelTop}" width="${cartW * 0.84}" height="${labelH}" rx="2" fill="${palette.label}"/>
        <text x="${w / 2}" y="${labelTop + labelH * 0.4}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.1, 20)}" font-weight="900">${safeTitle}</text>
        ${safeSubtitle ? `<text x="${w / 2}" y="${labelTop + labelH * 0.6}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.05, 11)}" font-weight="600" opacity=".7">${safeSubtitle}</text>` : ""}
        <rect x="${cartLeft + cartW * 0.3}" y="${cartTop + cartH * 0.05}" width="${cartW * 0.4}" height="${cartH * 0.08}" rx="2" fill="#999"/>
        <text x="${w / 2}" y="${cartBottom - cartH * 0.05}" text-anchor="middle" fill="#777" font-family="system-ui,sans-serif" font-size="8" font-weight="700" letter-spacing="2">GAME BOY</text>
      `;
    }
    case "gbc": {
      const cartTop = h * 0.1;
      const cartBottom = h * 0.9;
      const cartLeft = w * 0.14;
      const cartRight = w * 0.86;
      const cartW = cartRight - cartLeft;
      const cartH = cartBottom - cartTop;
      const labelTop = cartTop + cartH * 0.2;
      const labelH = cartH * 0.5;
      return `
        <rect x="${cartLeft}" y="${cartTop}" width="${cartW}" height="${cartH}" rx="4" fill="${palette.cartridge}" stroke="#7ab" stroke-width="1" opacity=".85"/>
        <rect x="${cartLeft + cartW * 0.08}" y="${labelTop}" width="${cartW * 0.84}" height="${labelH}" rx="2" fill="${palette.label}"/>
        <rect x="${cartLeft + cartW * 0.08}" y="${labelTop}" width="${cartW * 0.84}" height="${labelH * 0.1}" rx="2" fill="${palette.accent}" opacity=".7"/>
        <text x="${w / 2}" y="${labelTop + labelH * 0.42}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.1, 20)}" font-weight="900">${safeTitle}</text>
        ${safeSubtitle ? `<text x="${w / 2}" y="${labelTop + labelH * 0.6}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.05, 11)}" font-weight="600" opacity=".8">${safeSubtitle}</text>` : ""}
        <rect x="${cartLeft + cartW * 0.3}" y="${cartTop + cartH * 0.05}" width="${cartW * 0.4}" height="${cartH * 0.08}" rx="2" fill="${palette.secondary}" opacity=".5"/>
        <text x="${w / 2}" y="${cartBottom - cartH * 0.05}" text-anchor="middle" fill="${palette.accent}" font-family="system-ui,sans-serif" font-size="8" font-weight="700" letter-spacing="2">GAME BOY COLOR</text>
      `;
    }
    case "gba": {
      const cartTop = h * 0.12;
      const cartBottom = h * 0.88;
      const cartLeft = w * 0.16;
      const cartRight = w * 0.84;
      const cartW = cartRight - cartLeft;
      const cartH = cartBottom - cartTop;
      const labelTop = cartTop + cartH * 0.22;
      const labelH = cartH * 0.5;
      return `
        <rect x="${cartLeft}" y="${cartTop}" width="${cartW}" height="${cartH}" rx="3" fill="${palette.cartridge}" stroke="#444" stroke-width="1"/>
        <rect x="${cartLeft + cartW * 0.06}" y="${labelTop}" width="${cartW * 0.88}" height="${labelH}" rx="2" fill="${palette.label}"/>
        <rect x="${cartLeft + cartW * 0.06}" y="${labelTop}" width="${cartW * 0.88}" height="${labelH * 0.1}" rx="2" fill="${palette.accent}" opacity=".6"/>
        <text x="${w / 2}" y="${labelTop + labelH * 0.42}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.1, 18)}" font-weight="900">${safeTitle}</text>
        ${safeSubtitle ? `<text x="${w / 2}" y="${labelTop + labelH * 0.6}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.05, 10)}" font-weight="600" opacity=".7">${safeSubtitle}</text>` : ""}
        <rect x="${cartLeft + cartW * 0.35}" y="${cartTop + cartH * 0.04}" width="${cartW * 0.3}" height="${cartH * 0.1}" rx="2" fill="#333"/>
        <text x="${w / 2}" y="${cartBottom - cartH * 0.04}" text-anchor="middle" fill="#666" font-family="system-ui,sans-serif" font-size="7" font-weight="700" letter-spacing="2">ADVANCE</text>
      `;
    }
    case "segaMD": {
      const cartTop = h * 0.08;
      const cartBottom = h * 0.92;
      const cartLeft = w * 0.12;
      const cartRight = w * 0.88;
      const cartW = cartRight - cartLeft;
      const cartH = cartBottom - cartTop;
      const labelTop = cartTop + cartH * 0.15;
      const labelH = cartH * 0.6;
      return `
        <rect x="${cartLeft}" y="${cartTop}" width="${cartW}" height="${cartH}" rx="2" fill="${palette.cartridge}" stroke="#333" stroke-width="1.5"/>
        <rect x="${cartLeft + cartW * 0.06}" y="${labelTop}" width="${cartW * 0.88}" height="${labelH}" rx="2" fill="${palette.label}"/>
        <pattern id="segagrid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0v12" fill="none" stroke="${palette.accent}" stroke-opacity=".15" stroke-width="1"/>
        </pattern>
        <rect x="${cartLeft + cartW * 0.06}" y="${labelTop}" width="${cartW * 0.88}" height="${labelH}" rx="2" fill="url(#segagrid)"/>
        <text x="${w / 2}" y="${labelTop + labelH * 0.35}" text-anchor="middle" fill="${palette.accent}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.09, 20)}" font-weight="900">${safeTitle}</text>
        ${safeSubtitle ? `<text x="${w / 2}" y="${labelTop + labelH * 0.55}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(cartW * 0.05, 11)}" font-weight="600" opacity=".7">${safeSubtitle}</text>` : ""}
        <rect x="${cartLeft + cartW * 0.3}" y="${cartBottom - cartH * 0.1}" width="${cartW * 0.4}" height="${cartH * 0.05}" rx="1" fill="${palette.secondary}" opacity=".3"/>
        <text x="${w / 2}" y="${cartBottom - cartH * 0.03}" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="8" font-weight="700" letter-spacing="3" opacity=".6">MEGA DRIVE</text>
      `;
    }
  }
}

function buildIcon(
  system: RetroSystemId,
  palette: (typeof SYSTEM_PALETTE)[RetroSystemId],
): string {
  const cx = 60;
  const cy = 60;
  switch (system) {
    case "nes":
      return `<rect x="28" y="20" width="64" height="80" rx="4" fill="${palette.cartridge}" stroke="#999" stroke-width="1.5"/><rect x="34" y="34" width="52" height="40" rx="2" fill="${palette.label}"/><rect x="34" y="34" width="52" height="5" rx="2" fill="${palette.accent}"/><text x="60" y="58" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="10" font-weight="900">NES</text>`;
    case "snes":
      return `<rect x="24" y="16" width="72" height="88" rx="6" fill="${palette.cartridge}" stroke="#aaa" stroke-width="1.5"/><rect x="30" y="30" width="60" height="48" rx="3" fill="${palette.label}"/><rect x="30" y="30" width="60" height="4" rx="3" fill="${palette.accent}"/><text x="60" y="56" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="9" font-weight="900">SNES</text>`;
    case "gb":
      return `<rect x="34" y="22" width="52" height="76" rx="3" fill="${palette.cartridge}" stroke="#aaa" stroke-width="1"/><rect x="38" y="36" width="44" height="38" rx="2" fill="${palette.label}"/><text x="60" y="58" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="9" font-weight="900">GB</text>`;
    case "gbc":
      return `<rect x="34" y="22" width="52" height="76" rx="3" fill="${palette.cartridge}" stroke="#7ab" stroke-width="1" opacity=".85"/><rect x="38" y="36" width="44" height="38" rx="2" fill="${palette.label}"/><rect x="38" y="36" width="44" height="4" rx="2" fill="${palette.accent}" opacity=".7"/><text x="60" y="58" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="8" font-weight="900">GBC</text>`;
    case "gba":
      return `<rect x="36" y="26" width="48" height="68" rx="2" fill="${palette.cartridge}" stroke="#444" stroke-width="1"/><rect x="40" y="38" width="40" height="34" rx="2" fill="${palette.label}"/><rect x="40" y="38" width="40" height="3" rx="2" fill="${palette.accent}" opacity=".6"/><text x="60" y="58" text-anchor="middle" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="7" font-weight="900">GBA</text>`;
    case "segaMD":
      return `<rect x="28" y="20" width="64" height="80" rx="2" fill="${palette.cartridge}" stroke="#333" stroke-width="1.5"/><rect x="34" y="32" width="52" height="44" rx="2" fill="${palette.label}"/><pattern id="mdgrid${cx}${cy}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0v8" fill="none" stroke="${palette.accent}" stroke-opacity=".2" stroke-width="1"/></pattern><rect x="34" y="32" width="52" height="44" rx="2" fill="url(#mdgrid${cx}${cy})"/><text x="60" y="58" text-anchor="middle" fill="${palette.accent}" font-family="system-ui,sans-serif" font-size="8" font-weight="900">GEN</text>`;
  }
}

function buildBackground(
  system: RetroSystemId,
  palette: (typeof SYSTEM_PALETTE)[RetroSystemId],
  w: number,
  h: number,
): string {
  const gid = `bg-${system}-${w}-${h}`;
  return `
    <defs>
      <radialGradient id="${gid}" cx="70%" cy="15%" r="95%">
        <stop stop-color="${palette.accent}" stop-opacity=".22"/>
        <stop offset=".5" stop-color="${palette.secondary}" stop-opacity=".08"/>
        <stop offset="1" stop-color="${palette.bg}"/>
      </radialGradient>
      <pattern id="grid-${gid}" width="${Math.max(w, h) / 20}" height="${Math.max(w, h) / 20}" patternUnits="userSpaceOnUse">
        <path d="M${Math.max(w, h) / 20} 0H0v${Math.max(w, h) / 20}" fill="none" stroke="${palette.accent}" stroke-opacity=".06"/>
      </pattern>
      <linearGradient id="vignette-${gid}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${palette.bg}" stop-opacity="0"/>
        <stop offset="100%" stop-color="${palette.bg}" stop-opacity=".5"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="${palette.bg}"/>
    <rect width="${w}" height="${h}" fill="url(#${gid})"/>
    <rect width="${w}" height="${h}" fill="url(#grid-${gid})"/>
    <rect width="${w}" height="${h}" fill="url(#vignette-${gid})"/>
  `;
}

export function generateRetroArtwork(config: ArtworkConfig): string {
  const palette = SYSTEM_PALETTE[config.system];
  const accent = config.accent ?? palette.accent;
  const effectivePalette = { ...palette, accent };
  const { width, height, viewBox } = getDimensions(config.ratio);

  if (config.ratio === "icon") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${escapeXml(config.title)}">
      ${buildBackground(config.system, effectivePalette, width, height)}
      ${buildIcon(config.system, effectivePalette)}
    </svg>`;
  }

  const bg = buildBackground(config.system, effectivePalette, width, height);
  const cart = buildCartridge(
    config.system,
    effectivePalette,
    config.title,
    config.subtitle,
    width,
    height,
  );

  if (config.ratio === "hero") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${escapeXml(config.title)}">
      ${bg}
      <g transform="translate(${width * 0.55}, 0) scale(${height / 400})">
        ${buildCartridge(config.system, effectivePalette, config.title, config.subtitle, 300, 400)}
      </g>
      <rect x="0" y="${height * 0.65}" width="${width}" height="${height * 0.35}" fill="${palette.bg}" opacity=".8"/>
      <text x="${width * 0.04}" y="${height * 0.82}" fill="${accent}" font-family="system-ui,sans-serif" font-size="${Math.min(width * 0.04, 32)}" font-weight="900">${escapeXml(truncate(config.title, 30))}</text>
      ${config.subtitle ? `<text x="${width * 0.04}" y="${height * 0.92}" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(width * 0.02, 16)}" font-weight="600" opacity=".7">${escapeXml(truncate(config.subtitle, 40))}</text>` : ""}
    </svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${escapeXml(config.title)}">
    ${bg}
    ${cart}
  </svg>`;
}

export function artworkDataUrl(config: ArtworkConfig): string {
  const svg = generateRetroArtwork(config);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getSystemPalette(system: RetroSystemId) {
  return SYSTEM_PALETTE[system];
}
