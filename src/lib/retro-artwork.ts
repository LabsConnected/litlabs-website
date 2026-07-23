import type { RetroSystemId } from "./retro-arcade";

export type ArtworkRatio = "cover" | "hero" | "icon";

export interface ArtworkConfig {
  system: RetroSystemId;
  title: string;
  subtitle?: string;
  accent?: string;
  ratio: ArtworkRatio;
}

type Palette = {
  bg: string; bgDeep: string; accent: string; accent2: string;
  secondary: string; body: string; bodyDark: string; bodyLight: string;
  screen: string; label: string; trim: string;
};

const SYSTEM_PALETTE: Record<RetroSystemId, Palette> = {
  nes: {
    bg: "#1a1020", bgDeep: "#0d0810", accent: "#e63946", accent2: "#f8fafc",
    secondary: "#f8fafc", body: "#d4d4d8", bodyDark: "#a1a1aa", bodyLight: "#f4f4f5",
    screen: "#0a0510", label: "#e63946", trim: "#71717a",
  },
  snes: {
    bg: "#1c1428", bgDeep: "#0e0a14", accent: "#a78bfa", accent2: "#22d3ee",
    secondary: "#f8fafc", body: "#c8c8d0", bodyDark: "#9ca3af", bodyLight: "#e4e4e7",
    screen: "#0e0a14", label: "#7c5cbf", trim: "#71717a",
  },
  gb: {
    bg: "#0f1a0a", bgDeep: "#070d05", accent: "#a3e635", accent2: "#84cc16",
    secondary: "#f8fafc", body: "#d4d4d8", bodyDark: "#a1a1aa", bodyLight: "#f4f4f5",
    screen: "#0f1a0a", label: "#5a7a2a", trim: "#71717a",
  },
  gbc: {
    bg: "#1a1408", bgDeep: "#0d0a04", accent: "#fbbf24", accent2: "#f472b6",
    secondary: "#f8fafc", body: "#a5b4fc", bodyDark: "#818cf8", bodyLight: "#c7d2fe",
    screen: "#1a1408", label: "#d97706", trim: "#6366f1",
  },
  gba: {
    bg: "#0a1420", bgDeep: "#050a10", accent: "#38bdf8", accent2: "#818cf8",
    secondary: "#f8fafc", body: "#64748b", bodyDark: "#475569", bodyLight: "#94a3b8",
    screen: "#0a1420", label: "#1e6ba8", trim: "#334155",
  },
  segaMD: {
    bg: "#0a0a0f", bgDeep: "#050508", accent: "#22d3ee", accent2: "#f59e0b",
    secondary: "#f8fafc", body: "#1a1a1a", bodyDark: "#0a0a0a", bodyLight: "#3a3a3a",
    screen: "#0a0a0f", label: "#1a1a2e", trim: "#444",
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

function buildConsole(
  system: RetroSystemId,
  p: Palette,
  title: string,
  subtitle: string | undefined,
  w: number,
  h: number,
): string {
  const safeTitle = escapeXml(truncate(title, 24));
  const safeSubtitle = escapeXml(truncate(subtitle ?? "", 30));
  const uid = `${system}-${w}-${h}`;

  switch (system) {
    case "nes": return buildNES(p, safeTitle, safeSubtitle, w, h, uid);
    case "snes": return buildSNES(p, safeTitle, safeSubtitle, w, h, uid);
    case "gb": return buildGB(p, safeTitle, safeSubtitle, w, h, uid, false);
    case "gbc": return buildGB(p, safeTitle, safeSubtitle, w, h, uid, true);
    case "gba": return buildGBA(p, safeTitle, safeSubtitle, w, h, uid);
    case "segaMD": return buildGenesis(p, safeTitle, safeSubtitle, w, h, uid);
  }
}

function buildNES(
  p: Palette, title: string, subtitle: string, w: number, h: number, uid: string,
): string {
  const cx = w / 2;
  const bodyW = w * 0.72;
  const bodyH = h * 0.42;
  const bodyX = (w - bodyW) / 2;
  const bodyY = h * 0.16;
  const screenW = bodyW * 0.82;
  const screenH = bodyH * 0.72;
  const screenX = bodyX + (bodyW - screenW) / 2;
  const screenY = bodyY + bodyH * 0.14;

  return `
    <defs>
      <linearGradient id="nes-body-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="${p.bodyLight}"/><stop offset=".5" stop-color="${p.body}"/><stop offset="1" stop-color="${p.bodyDark}"/>
      </linearGradient>
      <linearGradient id="nes-screen-${uid}" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${p.bgDeep}"/><stop offset=".5" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.bgDeep}"/>
      </linearGradient>
      <radialGradient id="nes-glow-${uid}" cx="50%" cy="40%" r="60%">
        <stop stop-color="${p.accent}" stop-opacity=".25"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect x="${bodyX - 6}" y="${bodyY - 6}" width="${bodyW + 12}" height="${bodyH + 12}" rx="10" fill="url(#nes-glow-${uid})"/>
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="8" fill="url(#nes-body-${uid})" stroke="${p.trim}" stroke-width="1.5"/>
    <rect x="${screenX}" y="${screenY}" width="${screenW}" height="${screenH}" rx="4" fill="url(#nes-screen-${uid})" stroke="${p.trim}" stroke-width="1"/>
    <rect x="${screenX + 4}" y="${screenY + 4}" width="${screenW - 8}" height="${screenH - 8}" rx="2" fill="${p.bgDeep}" opacity=".6"/>
    <text x="${cx}" y="${screenY + screenH * 0.35}" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.14, 18)}" font-weight="900">${title}</text>
    ${subtitle ? `<text x="${cx}" y="${screenY + screenH * 0.6}" text-anchor="middle" fill="${p.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.07, 9)}" font-weight="600" opacity=".7">${subtitle}</text>` : ""}
    <rect x="${bodyX + bodyW * 0.08}" y="${bodyY + bodyH * 0.9}" width="${bodyW * 0.12}" height="6" rx="2" fill="${p.accent}"/>
    <rect x="${bodyX + bodyW * 0.24}" y="${bodyY + bodyH * 0.9}" width="${bodyW * 0.12}" height="6" rx="2" fill="${p.accent2}" opacity=".7"/>
    <circle cx="${bodyX + bodyW * 0.82}" cy="${bodyY + bodyH * 0.93}" r="5" fill="${p.trim}" stroke="${p.bodyDark}" stroke-width="1"/>
    <circle cx="${bodyX + bodyW * 0.82}" cy="${bodyY + bodyH * 0.93}" r="2" fill="${p.accent}" opacity=".5"/>
    <text x="${cx}" y="${bodyY + bodyH + 28}" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="11" font-weight="900" letter-spacing="3" opacity=".8">NES</text>
    <text x="${cx}" y="${h - 20}" text-anchor="middle" fill="${p.secondary}" font-family="system-ui,sans-serif" font-size="9" font-weight="600" opacity=".4">NINTENDO ENTERTAINMENT SYSTEM</text>
  `;
}

function buildSNES(
  p: Palette, title: string, subtitle: string, w: number, h: number, uid: string,
): string {
  const cx = w / 2;
  const bodyW = w * 0.76;
  const bodyH = h * 0.38;
  const bodyX = (w - bodyW) / 2;
  const bodyY = h * 0.18;
  const screenW = bodyW * 0.84;
  const screenH = bodyH * 0.68;
  const screenX = bodyX + (bodyW - screenW) / 2;
  const screenY = bodyY + bodyH * 0.16;

  return `
    <defs>
      <linearGradient id="snes-body-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="${p.bodyLight}"/><stop offset=".5" stop-color="${p.body}"/><stop offset="1" stop-color="${p.bodyDark}"/>
      </linearGradient>
      <linearGradient id="snes-screen-${uid}" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${p.bgDeep}"/><stop offset=".5" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.bgDeep}"/>
      </linearGradient>
      <radialGradient id="snes-glow-${uid}" cx="50%" cy="40%" r="60%">
        <stop stop-color="${p.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect x="${bodyX - 6}" y="${bodyY - 6}" width="${bodyW + 12}" height="${bodyH + 12}" rx="12" fill="url(#snes-glow-${uid})"/>
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="10" fill="url(#snes-body-${uid})" stroke="${p.trim}" stroke-width="1.5"/>
    <rect x="${screenX}" y="${screenY}" width="${screenW}" height="${screenH}" rx="6" fill="url(#snes-screen-${uid})" stroke="${p.trim}" stroke-width="1"/>
    <rect x="${screenX + 4}" y="${screenY + 4}" width="${screenW - 8}" height="${screenH - 8}" rx="4" fill="${p.bgDeep}" opacity=".5"/>
    <text x="${cx}" y="${screenY + screenH * 0.35}" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.14, 18)}" font-weight="900">${title}</text>
    ${subtitle ? `<text x="${cx}" y="${screenY + screenH * 0.6}" text-anchor="middle" fill="${p.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.07, 9)}" font-weight="600" opacity=".7">${subtitle}</text>` : ""}
    <circle cx="${bodyX + bodyW * 0.12}" cy="${bodyY + bodyH * 0.88}" r="6" fill="${p.trim}" stroke="${p.bodyDark}" stroke-width="1"/>
    <circle cx="${bodyX + bodyW * 0.12}" cy="${bodyY + bodyH * 0.88}" r="2.5" fill="${p.accent}" opacity=".4"/>
    <circle cx="${bodyX + bodyW * 0.88}" cy="${bodyY + bodyH * 0.88}" r="6" fill="${p.trim}" stroke="${p.bodyDark}" stroke-width="1"/>
    <circle cx="${bodyX + bodyW * 0.88}" cy="${bodyY + bodyH * 0.88}" r="2.5" fill="${p.accent2}" opacity=".4"/>
    <rect x="${bodyX + bodyW * 0.4}" y="${bodyY + bodyH * 0.85}" width="${bodyW * 0.2}" height="8" rx="3" fill="${p.trim}" opacity=".5"/>
    <text x="${cx}" y="${bodyY + bodyH + 28}" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="11" font-weight="900" letter-spacing="3" opacity=".8">SNES</text>
    <text x="${cx}" y="${h - 20}" text-anchor="middle" fill="${p.secondary}" font-family="system-ui,sans-serif" font-size="9" font-weight="600" opacity=".4">SUPER NINTENDO</text>
  `;
}

function buildGB(
  p: Palette, title: string, subtitle: string, w: number, h: number, uid: string, isColor: boolean,
): string {
  const cx = w / 2;
  const bodyW = w * 0.56;
  const bodyH = h * 0.62;
  const bodyX = (w - bodyW) / 2;
  const bodyY = h * 0.1;
  const screenW = bodyW * 0.78;
  const screenH = bodyH * 0.38;
  const screenX = bodyX + (bodyW - screenW) / 2;
  const screenY = bodyY + bodyH * 0.1;
  const accentColor = isColor ? p.accent : p.accent;

  return `
    <defs>
      <linearGradient id="gb-body-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="${p.bodyLight}"/><stop offset=".5" stop-color="${p.body}"/><stop offset="1" stop-color="${p.bodyDark}"/>
      </linearGradient>
      <linearGradient id="gb-screen-${uid}" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${p.bgDeep}"/><stop offset=".5" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.bgDeep}"/>
      </linearGradient>
      <radialGradient id="gb-glow-${uid}" cx="50%" cy="30%" r="55%">
        <stop stop-color="${accentColor}" stop-opacity=".2"/><stop offset="1" stop-color="${accentColor}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect x="${bodyX - 5}" y="${bodyY - 5}" width="${bodyW + 10}" height="${bodyH + 10}" rx="14" fill="url(#gb-glow-${uid})"/>
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="10" fill="url(#gb-body-${uid})" stroke="${p.trim}" stroke-width="1.5"/>
    <rect x="${screenX - 6}" y="${screenY - 6}" width="${screenW + 12}" height="${screenH + 12}" rx="6" fill="${p.bodyDark}" opacity=".6"/>
    <rect x="${screenX}" y="${screenY}" width="${screenW}" height="${screenH}" rx="3" fill="url(#gb-screen-${uid})" stroke="${p.trim}" stroke-width="1"/>
    <rect x="${screenX + 3}" y="${screenY + 3}" width="${screenW - 6}" height="${screenH - 6}" rx="2" fill="${p.bgDeep}" opacity=".5"/>
    <text x="${cx}" y="${screenY + screenH * 0.4}" text-anchor="middle" fill="${accentColor}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.16, 15)}" font-weight="900">${title}</text>
    ${subtitle ? `<text x="${cx}" y="${screenY + screenH * 0.7}" text-anchor="middle" fill="${p.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.08, 7)}" font-weight="600" opacity=".7">${subtitle}</text>` : ""}
    <circle cx="${bodyX + bodyW * 0.25}" cy="${bodyY + bodyH * 0.62}" r="7" fill="${p.trim}" opacity=".5"/>
    <circle cx="${bodyX + bodyW * 0.75}" cy="${bodyY + bodyH * 0.62}" r="7" fill="${p.trim}" opacity=".5"/>
    <rect x="${bodyX + bodyW * 0.35}" y="${bodyY + bodyH * 0.78}" width="${bodyW * 0.3}" height="5" rx="2" fill="${p.trim}" opacity=".4"/>
    <rect x="${bodyX + bodyW * 0.15}" y="${bodyY + bodyH * 0.88}" width="${bodyW * 0.7}" height="3" rx="1" fill="${accentColor}" opacity=".3"/>
    <text x="${cx}" y="${bodyY + bodyH + 24}" text-anchor="middle" fill="${accentColor}" font-family="system-ui,sans-serif" font-size="10" font-weight="900" letter-spacing="2" opacity=".8">${isColor ? "GBC" : "GB"}</text>
    <text x="${cx}" y="${h - 18}" text-anchor="middle" fill="${p.secondary}" font-family="system-ui,sans-serif" font-size="8" font-weight="600" opacity=".4">${isColor ? "GAME BOY COLOR" : "GAME BOY"}</text>
  `;
}

function buildGBA(
  p: Palette, title: string, subtitle: string, w: number, h: number, uid: string,
): string {
  const cx = w / 2;
  const bodyW = w * 0.64;
  const bodyH = h * 0.4;
  const bodyX = (w - bodyW) / 2;
  const bodyY = h * 0.16;
  const screenW = bodyW * 0.72;
  const screenH = bodyH * 0.62;
  const screenX = bodyX + (bodyW - screenW) / 2;
  const screenY = bodyY + bodyH * 0.18;

  return `
    <defs>
      <linearGradient id="gba-body-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="${p.bodyLight}"/><stop offset=".5" stop-color="${p.body}"/><stop offset="1" stop-color="${p.bodyDark}"/>
      </linearGradient>
      <linearGradient id="gba-screen-${uid}" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${p.bgDeep}"/><stop offset=".5" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.bgDeep}"/>
      </linearGradient>
      <radialGradient id="gba-glow-${uid}" cx="50%" cy="40%" r="55%">
        <stop stop-color="${p.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect x="${bodyX - 6}" y="${bodyY - 6}" width="${bodyW + 12}" height="${bodyH + 12}" rx="16" fill="url(#gba-glow-${uid})"/>
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="14" fill="url(#gba-body-${uid})" stroke="${p.trim}" stroke-width="1.5"/>
    <rect x="${screenX - 4}" y="${screenY - 4}" width="${screenW + 8}" height="${screenH + 8}" rx="6" fill="${p.bodyDark}" opacity=".5"/>
    <rect x="${screenX}" y="${screenY}" width="${screenW}" height="${screenH}" rx="4" fill="url(#gba-screen-${uid})" stroke="${p.trim}" stroke-width="1"/>
    <rect x="${screenX + 3}" y="${screenY + 3}" width="${screenW - 6}" height="${screenH - 6}" rx="3" fill="${p.bgDeep}" opacity=".5"/>
    <text x="${cx}" y="${screenY + screenH * 0.4}" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.15, 16)}" font-weight="900">${title}</text>
    ${subtitle ? `<text x="${cx}" y="${screenY + screenH * 0.7}" text-anchor="middle" fill="${p.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.08, 8)}" font-weight="600" opacity=".7">${subtitle}</text>` : ""}
    <rect x="${bodyX + bodyW * 0.06}" y="${bodyY + bodyH * 0.82}" width="${bodyW * 0.14}" height="10" rx="3" fill="${p.trim}" opacity=".5"/>
    <rect x="${bodyX + bodyW * 0.8}" y="${bodyY + bodyH * 0.82}" width="${bodyW * 0.14}" height="10" rx="3" fill="${p.trim}" opacity=".5"/>
    <rect x="${bodyX + bodyW * 0.35}" y="${bodyY + bodyH * 0.9}" width="${bodyW * 0.3}" height="6" rx="2" fill="${p.accent}" opacity=".3"/>
    <text x="${cx}" y="${bodyY + bodyH + 26}" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="11" font-weight="900" letter-spacing="2" opacity=".8">GBA</text>
    <text x="${cx}" y="${h - 18}" text-anchor="middle" fill="${p.secondary}" font-family="system-ui,sans-serif" font-size="8" font-weight="600" opacity=".4">GAME BOY ADVANCE</text>
  `;
}

function buildGenesis(
  p: Palette, title: string, subtitle: string, w: number, h: number, uid: string,
): string {
  const cx = w / 2;
  const bodyW = w * 0.72;
  const bodyH = h * 0.4;
  const bodyX = (w - bodyW) / 2;
  const bodyY = h * 0.16;
  const screenW = bodyW * 0.8;
  const screenH = bodyH * 0.65;
  const screenX = bodyX + (bodyW - screenW) / 2;
  const screenY = bodyY + bodyH * 0.17;

  return `
    <defs>
      <linearGradient id="gen-body-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="${p.bodyLight}"/><stop offset=".5" stop-color="${p.body}"/><stop offset="1" stop-color="${p.bodyDark}"/>
      </linearGradient>
      <linearGradient id="gen-screen-${uid}" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${p.bgDeep}"/><stop offset=".5" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.bgDeep}"/>
      </linearGradient>
      <radialGradient id="gen-glow-${uid}" cx="50%" cy="40%" r="55%">
        <stop stop-color="${p.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect x="${bodyX - 6}" y="${bodyY - 6}" width="${bodyW + 12}" height="${bodyH + 12}" rx="10" fill="url(#gen-glow-${uid})"/>
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="8" fill="url(#gen-body-${uid})" stroke="${p.trim}" stroke-width="1.5"/>
    <rect x="${screenX}" y="${screenY}" width="${screenW}" height="${screenH}" rx="4" fill="url(#gen-screen-${uid})" stroke="${p.accent}" stroke-width="1" stroke-opacity=".3"/>
    <rect x="${screenX + 3}" y="${screenY + 3}" width="${screenW - 6}" height="${screenH - 6}" rx="3" fill="${p.bgDeep}" opacity=".5"/>
    <text x="${cx}" y="${screenY + screenH * 0.35}" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.14, 17)}" font-weight="900">${title}</text>
    ${subtitle ? `<text x="${cx}" y="${screenY + screenH * 0.6}" text-anchor="middle" fill="${p.accent2}" font-family="system-ui,sans-serif" font-size="${Math.min(screenW * 0.07, 9)}" font-weight="600" opacity=".7">${subtitle}</text>` : ""}
    <circle cx="${bodyX + bodyW * 0.15}" cy="${bodyY + bodyH * 0.88}" r="6" fill="${p.accent}" opacity=".3"/>
    <circle cx="${bodyX + bodyW * 0.85}" cy="${bodyY + bodyH * 0.88}" r="6" fill="${p.accent2}" opacity=".3"/>
    <rect x="${bodyX + bodyW * 0.38}" y="${bodyY + bodyH * 0.85}" width="${bodyW * 0.24}" height="8" rx="3" fill="${p.trim}" opacity=".4"/>
    <text x="${cx}" y="${bodyY + bodyH + 26}" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="11" font-weight="900" letter-spacing="3" opacity=".8">GENESIS</text>
    <text x="${cx}" y="${h - 18}" text-anchor="middle" fill="${p.secondary}" font-family="system-ui,sans-serif" font-size="8" font-weight="600" opacity=".4">SEGA MEGA DRIVE</text>
  `;
}

function buildIcon(
  system: RetroSystemId,
  p: Palette,
): string {
  switch (system) {
    case "nes":
      return `<rect x="28" y="20" width="64" height="80" rx="6" fill="${p.body}" stroke="${p.trim}" stroke-width="1.5"/><rect x="34" y="34" width="52" height="40" rx="3" fill="${p.screen}"/><rect x="34" y="34" width="52" height="5" rx="2" fill="${p.accent}"/><text x="60" y="58" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="10" font-weight="900">NES</text>`;
    case "snes":
      return `<rect x="24" y="16" width="72" height="88" rx="8" fill="${p.body}" stroke="${p.trim}" stroke-width="1.5"/><rect x="30" y="30" width="60" height="48" rx="4" fill="${p.screen}"/><rect x="30" y="30" width="60" height="4" rx="3" fill="${p.accent}"/><text x="60" y="56" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="9" font-weight="900">SNES</text>`;
    case "gb":
      return `<rect x="34" y="22" width="52" height="76" rx="6" fill="${p.body}" stroke="${p.trim}" stroke-width="1"/><rect x="38" y="36" width="44" height="38" rx="3" fill="${p.screen}"/><text x="60" y="58" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="9" font-weight="900">GB</text>`;
    case "gbc":
      return `<rect x="34" y="22" width="52" height="76" rx="6" fill="${p.body}" stroke="${p.trim}" stroke-width="1" opacity=".9"/><rect x="38" y="36" width="44" height="38" rx="3" fill="${p.screen}"/><rect x="38" y="36" width="44" height="4" rx="2" fill="${p.accent}" opacity=".7"/><text x="60" y="58" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="8" font-weight="900">GBC</text>`;
    case "gba":
      return `<rect x="36" y="26" width="48" height="68" rx="8" fill="${p.body}" stroke="${p.trim}" stroke-width="1"/><rect x="40" y="38" width="40" height="34" rx="3" fill="${p.screen}"/><rect x="40" y="38" width="40" height="3" rx="2" fill="${p.accent}" opacity=".6"/><text x="60" y="58" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="7" font-weight="900">GBA</text>`;
    case "segaMD":
      return `<rect x="28" y="20" width="64" height="80" rx="4" fill="${p.body}" stroke="${p.trim}" stroke-width="1.5"/><rect x="34" y="32" width="52" height="44" rx="2" fill="${p.screen}"/><text x="60" y="58" text-anchor="middle" fill="${p.accent}" font-family="system-ui,sans-serif" font-size="8" font-weight="900">GEN</text>`;
  }
}

function buildBackground(
  system: RetroSystemId,
  p: Palette,
  w: number,
  h: number,
): string {
  const gid = `bg-${system}-${w}-${h}`;
  return `
    <defs>
      <radialGradient id="${gid}" cx="65%" cy="20%" r="90%">
        <stop stop-color="${p.accent}" stop-opacity=".18"/>
        <stop offset=".5" stop-color="${p.accent2}" stop-opacity=".06"/>
        <stop offset="1" stop-color="${p.bgDeep}"/>
      </radialGradient>
      <pattern id="grid-${gid}" width="${Math.max(w, h) / 18}" height="${Math.max(w, h) / 18}" patternUnits="userSpaceOnUse">
        <path d="M${Math.max(w, h) / 18} 0H0v${Math.max(w, h) / 18}" fill="none" stroke="${p.accent}" stroke-opacity=".05"/>
      </pattern>
      <linearGradient id="vignette-${gid}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${p.bgDeep}" stop-opacity="0"/>
        <stop offset="100%" stop-color="${p.bgDeep}" stop-opacity=".6"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="${p.bgDeep}"/>
    <rect width="${w}" height="${h}" fill="url(#${gid})"/>
    <rect width="${w}" height="${h}" fill="url(#grid-${gid})"/>
    <rect width="${w}" height="${h}" fill="url(#vignette-${gid})"/>
  `;
}

export function generateRetroArtwork(config: ArtworkConfig): string {
  const palette = SYSTEM_PALETTE[config.system];
  const accent = config.accent ?? palette.accent;
  const effectivePalette: Palette = { ...palette, accent };
  const { width, height, viewBox } = getDimensions(config.ratio);

  if (config.ratio === "icon") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${escapeXml(config.title)}">
      ${buildBackground(config.system, effectivePalette, width, height)}
      ${buildIcon(config.system, effectivePalette)}
    </svg>`;
  }

  const bg = buildBackground(config.system, effectivePalette, width, height);
  const console = buildConsole(
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
      <g transform="translate(${width * 0.3}, ${height * 0.05}) scale(${height / 400})">
        ${buildConsole(config.system, effectivePalette, config.title, config.subtitle, 300, 400)}
      </g>
      <rect x="0" y="${height * 0.7}" width="${width}" height="${height * 0.3}" fill="${palette.bgDeep}" opacity=".85"/>
      <text x="${width * 0.04}" y="${height * 0.85}" fill="${accent}" font-family="system-ui,sans-serif" font-size="${Math.min(width * 0.04, 32)}" font-weight="900">${escapeXml(truncate(config.title, 30))}</text>
      ${config.subtitle ? `<text x="${width * 0.04}" y="${height * 0.93}" fill="${palette.secondary}" font-family="system-ui,sans-serif" font-size="${Math.min(width * 0.02, 16)}" font-weight="600" opacity=".7">${escapeXml(truncate(config.subtitle, 40))}</text>` : ""}
    </svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${escapeXml(config.title)}">
    ${bg}
    ${console}
  </svg>`;
}

export function artworkDataUrl(config: ArtworkConfig): string {
  const svg = generateRetroArtwork(config);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getSystemPalette(system: RetroSystemId) {
  return SYSTEM_PALETTE[system];
}
