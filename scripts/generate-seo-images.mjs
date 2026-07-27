// One-off script: generate SEO/brand images from existing logo assets using sharp.
// Run with: node scripts/generate-seo-images.mjs
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const LOGO_PNG = join(ROOT, "public", "logo.png");

async function generateIcon512() {
  const dest = join(ROOT, "public", "icon-512.png");
  if (!existsSync(LOGO_PNG)) throw new Error("public/logo.png not found");
  await sharp(LOGO_PNG)
    .resize(512, 512, { fit: "contain", background: { r: 3, g: 5, b: 11, alpha: 1 } })
    .png()
    .toFile(dest);
  console.log("Created", dest);
}

async function generateAppleIcon() {
  const dest = join(ROOT, "src", "app", "apple-icon.png");
  if (!existsSync(LOGO_PNG)) throw new Error("public/logo.png not found");
  await sharp(LOGO_PNG)
    .resize(180, 180, { fit: "contain", background: { r: 3, g: 5, b: 11, alpha: 1 } })
    .png()
    .toFile(dest);
  console.log("Created", dest);
}

async function generateAppIcon() {
  const dest = join(ROOT, "src", "app", "icon.png");
  if (!existsSync(LOGO_PNG)) throw new Error("public/logo.png not found");
  await sharp(LOGO_PNG)
    .resize(512, 512, { fit: "contain", background: { r: 3, g: 5, b: 11, alpha: 1 } })
    .png()
    .toFile(dest);
  console.log("Created", dest);
}

async function generateOgImage() {
  const dest = join(ROOT, "public", "og", "littree-labstudios.jpg");
  mkdirSync(dirname(dest), { recursive: true });

  // Build an SVG with brand text overlaid on a dark gradient background
  const svg = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#03050b"/>
      <stop offset="50%" stop-color="#0a0e1a"/>
      <stop offset="100%" stop-color="#050810"/>
    </linearGradient>
    <radialGradient id="glow1" cx="78%" cy="35%" r="32%">
      <stop offset="0%" stop-color="#a970ff" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#a970ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="22%" cy="24%" r="27%">
      <stop offset="0%" stop-color="#a8ff2f" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#a8ff2f" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  <text x="80" y="250" font-family="Inter, Arial, sans-serif" font-size="72" font-weight="900" fill="#eef4ff">LiTTree LabStudios</text>
  <text x="80" y="330" font-family="Inter, Arial, sans-serif" font-size="36" font-weight="600" fill="#9ba7c7">AI Creative Studio for Apps, Art &amp; Projects</text>
  <text x="80" y="540" font-family="JetBrains Mono, monospace" font-size="24" font-weight="700" fill="#a8ff2f">litlabs.net</text>
</svg>`;

  await sharp(Buffer.from(svg))
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(dest);
  console.log("Created", dest);
}

async function main() {
  await generateIcon512();
  await generateAppleIcon();
  await generateAppIcon();
  await generateOgImage();
  console.log("All SEO images generated.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
