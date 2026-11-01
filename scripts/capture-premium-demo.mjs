import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, '..', 'public', 'premium-demo.html');
const fileUrl = 'file://' + filePath.replace(/\\/g, '/');

const viewports = [
  { width: 1440, height: 900, name: '1440' },
  { width: 768, height: 1024, name: '768' },
  { width: 390, height: 844, name: '390' },
  { width: 320, height: 568, name: '320' },
];

const browser = await chromium.launch();
try {
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(fileUrl, { waitUntil: 'networkidle' });
    // Give fonts a moment
    await page.waitForTimeout(800);
    const out = path.join(__dirname, '..', `premium-demo-${vp.name}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`captured ${out} at ${vp.width}x${vp.height}`);
    await context.close();
  }
  console.log('all screenshots done');
} finally {
  await browser.close();
}
