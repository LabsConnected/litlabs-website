const { execSync } = require('child_process');
const patterns = [
  'sk_live', 'sk_test', 'AIza', 'ghp_', 'github_pat_',
  'SUPABASE_SERVICE_ROLE', 'CLERK_SECRET', 'STRIPE_SECRET',
  'STRIPE_LIVE', 'VAPI_', 'OPENROUTER_API_KEY', 'xoxb-', 'AKIA'
];
const exts = '*.ts *.tsx *.js *.jsx *.json *.md *.env *.yml *.yaml *.sh *.txt';
let found = [];

for (const p of patterns) {
  try {
    const cmd = `findstr /s /n /i "${p}" ${exts}`;
    const out = execSync(cmd, { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 });
    const lines = out.split('\n').filter(l =>
      l.trim() &&
      !l.includes('node_modules') &&
      !l.includes('.next') &&
      !l.includes('packages/') &&
      !l.includes('terminal-server/node_modules') &&
      !l.includes('voice-server/node_modules')
    );
    if (lines.length > 0) found.push({ pattern: p, matches: lines.slice(0, 15) });
  } catch {}
}

if (found.length === 0) {
  console.log('NO SECRETS FOUND IN SOURCE FILES');
} else {
  for (const f of found) {
    console.log(`\nPATTERN: ${f.pattern} (${f.matches.length} matches)`);
    f.matches.forEach(m => console.log('  ' + m.trim()));
  }
}
