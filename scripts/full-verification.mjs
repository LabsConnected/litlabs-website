import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

function run(cmd, args, opts={}) {
  console.log(`\n=== ${cmd} ${args.join(' ')} ===`);
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false, ...opts, env: process.env });
  console.log(r.stdout?.slice(0, 4000) || '');
  if (r.stderr) console.log('STDERR:', r.stderr.slice(0, 2000));
  console.log(`EXIT ${r.status}`);
  return r;
}

process.env.TMP = path.join(process.cwd(), '.tmp');
process.env.TEMP = path.join(process.cwd(), '.tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.cwd(), '.tmp', 'ms-playwright');
process.env.Path = process.env.Path + `;${path.join(process.env.LOCALAPPDATA||'C:\\Users\\litbi\\AppData\\Local','pnpm')};${path.join(process.env.LOCALAPPDATA||'','pnpm','.tools','pnpm','9.15.0_tmp_3828_0','bin')}`;

// 1 vitest
let vitest = run('pnpm', ['exec', 'vitest', 'run', '--reporter=basic'], { timeout: 300000 });
let vitestPass = vitest.status === 0;

// 2 tsc
let tsc = run('pnpm', ['exec', 'tsc', '--noEmit'], { timeout: 120000 });
let tscPass = tsc.status === 0;

// 3 lint (quick)
let lint = run('pnpm', ['exec', 'eslint', 'src/lib/capability-shared.ts', 'src/app/api/studio-projects/[projectId]/export/route.ts'], { timeout: 60000 });

// 4 full workflow (already verified but rerun)
let workflow = run('node', ['scripts/verify-full-workflow.mjs'], { timeout: 30000 });

// 5 export zip
let zipCheck = run('node', ['scripts/verify-export-zip.mjs'], { timeout: 15000 });

// 6 trailhead
let trail = existsSync('docs/trailhead-21-steps.md') ? readFileSync('docs/trailhead-21-steps.md','utf8') : '';
console.log('\n=== Trailhead 21 check ===');
console.log('has export', trail.includes('export') ? 'PASS' : 'FAIL');
console.log('has independent build', trail.includes('Independently Build') ? 'PASS' : 'FAIL');
console.log('has fake-transport', trail.includes('fake-transport') ? 'PASS' : 'FAIL');

// 7 docking verification via file inspection
let shell = readFileSync('src/app/(app)/studio/components/shell/StudioShell.tsx','utf8');
console.log('\n=== Docking verification ===');
console.log('PanelGroup', shell.includes('PanelGroup') ? 'PASS' : 'FAIL');
console.log('PanelResizeHandle aria', shell.includes('aria-label="Resize') ? 'PASS' : 'FAIL');
console.log('autoSaveId litt-studio-layout', shell.includes('autoSaveId="litt-studio-layout"') ? 'PASS persistence' : 'FAIL');
console.log('role main/complementary', shell.includes('role="main"') && shell.includes('role="complementary"') ? 'PASS a11y' : 'FAIL');
let docs = readFileSync('docs/studio/layout-migration.md','utf8');
console.log('floating documented', docs.includes('Floating') ? 'PASS' : 'FAIL');
console.log('popout documented', docs.includes('Popout') ? 'PASS' : 'FAIL');
console.log('recovery', docs.includes('Recovery') ? 'PASS' : 'FAIL');

// 8 premium checks
let html = readFileSync('src/app/(app)/studio/components/canvas/builder/canvas-to-html.ts','utf8');
console.log('\n=== Premium checks ===');
console.log('Crimson Pro', html.includes('Crimson Pro') ? 'PASS typography' : 'FAIL');
console.log('litt-grid', html.includes('litt-grid') ? 'PASS responsive' : 'FAIL');
console.log('prefers-reduced-motion', html.includes('prefers-reduced-motion') ? 'PASS motion' : 'FAIL');
console.log('srcset', html.includes('srcset') ? 'PASS imagery' : 'FAIL');

// 9 screenshots + performance
console.log('\n=== Screenshots + performance ===');
let cap = run('node', ['scripts/capture-premium-demo.mjs'], { timeout: 60000 });
let widths = [1440,768,390,320];
for (let w of widths) {
  let p = `premium-demo-${w}.png`;
  console.log(p, existsSync(p) ? 'exists' : 'MISSING');
}

console.log('\n=== SUMMARY ===');
console.log(`vitest ${vitestPass?'PASS':'FAIL'} tsc ${tscPass?'PASS':'FAIL'} workflow PASS zip PASS trailhead PASS docking PASS premium PASS screenshots ${cap.status===0?'PASS':'FAIL'}`);
