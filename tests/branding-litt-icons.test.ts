import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function readPngDims(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    `${path} is not a valid PNG`,
  );
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** ICO directory entries: byte0=width (0=>256), byte1=height */
function readIcoSizes(path: string): Array<[number, number]> {
  const bytes = readFileSync(path);
  expect(bytes.readUInt16LE(2)).toBe(1); // type 1 = ICO
  const count = bytes.readUInt16LE(4);
  const sizes: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const w = bytes[off] === 0 ? 256 : bytes[off];
    const h = bytes[off + 1] === 0 ? 256 : bytes[off + 1];
    sizes.push([w, h]);
  }
  return sizes;
}

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const s = max === 0 ? 0 : d / max;
  return [h * 360, s, max];
}

/** Pink/magenta family: hue ~280°–350° with real saturation. */
function isPinkFamily(hex: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  const [h, s, v] = hexToHsv(hex);
  return h >= 280 && h <= 350 && s > 0.25 && v > 0.2;
}

describe("LiTT-only branding: manifest + icon set", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "public/manifest.json"), "utf8"));

  it('names the app "LiTT" (no LiTTree drift)', () => {
    expect(manifest.name).toBe("LiTT");
    expect(manifest.short_name).toBe("LiTT");
    for (const field of ["name", "short_name", "theme_color"] as const) {
      expect(String(manifest[field]).toLowerCase()).not.toContain("littree");
    }
  });

  it("theme_color is not pink/magenta-family", () => {
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(isPinkFamily(manifest.theme_color)).toBe(false);
    // guard: the old offending value must actually trip the detector
    expect(isPinkFamily("#ff00a0")).toBe(true);
  });

  it("every manifest icon resolves to a real file with matching dimensions", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose ?? "any");
    expect(purposes).toContain("maskable");
    for (const icon of manifest.icons as Array<{ src: string; sizes: string }>) {
      expect(icon.src.startsWith("/")).toBe(true);
      const file = join(ROOT, "public", icon.src.slice(1));
      expect(existsSync(file), `${icon.src} must exist under public/`).toBe(true);
      const [w, h] = icon.sizes.split("x").map(Number);
      const dims = readPngDims(file);
      expect(dims.width).toBe(w);
      expect(dims.height).toBe(h);
    }
  });

  it("manifest shortcut icons resolve to real files", () => {
    for (const sc of manifest.shortcuts ?? []) {
      for (const icon of sc.icons ?? []) {
        const file = join(ROOT, "public", String(icon.src).replace(/^\//, ""));
        expect(existsSync(file), `shortcut icon ${icon.src} must exist`).toBe(true);
      }
    }
  });

  it("favicon.ico is a valid ICO containing 16/32/48", () => {
    const sizes = readIcoSizes(join(ROOT, "src/app/favicon.ico"));
    for (const s of [16, 32, 48]) {
      expect(sizes.some(([w, h]) => w === s && h === s), `ICO must contain ${s}x${s}`).toBe(true);
    }
  });

  it("apple-icon.png is 180x180", () => {
    expect(readPngDims(join(ROOT, "src/app/apple-icon.png"))).toEqual({ width: 180, height: 180 });
  });

  it("src/app/icon.png is 512x512", () => {
    expect(readPngDims(join(ROOT, "src/app/icon.png"))).toEqual({ width: 512, height: 512 });
  });
});
