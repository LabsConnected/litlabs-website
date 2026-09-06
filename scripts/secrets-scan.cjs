#!/usr/bin/env node
// Local secrets scan, mirroring the blocking CI check in .github/workflows/build.yml.
// Uses `git grep` (portable across Linux/macOS/Windows/Termux wherever git is installed)
// and matches actual secret-shaped strings rather than bare env-var-name keywords,
// so it doesn't drown in false positives from docs/tests that merely reference key names.
const { execFileSync } = require('child_process');

const patterns = [
  'gsk_[A-Za-z0-9]{40,}',
  'sk-proj-[A-Za-z0-9]{40,}',
  'sk_live_clerk_[A-Za-z0-9]{30,}',
  'sk_live_[A-Za-z0-9]{40,}',
  'sk_test_[A-Za-z0-9]{40,}',
  'AIza[A-Za-z0-9_-]{35}',
  'ghp_[A-Za-z0-9]{36,}',
  'github_pat_[A-Za-z0-9_]{60,}',
  'xoxb-[A-Za-z0-9-]{20,}',
  'AKIA[A-Z0-9]{16}',
  'eyJ[A-Za-z0-9_-]*\\.eyJ[A-Za-z0-9_-]*\\.sbp_[A-Za-z0-9]',
];

const pathExcludes = [
  ':!*.test.ts', ':!*.test.tsx', ':!tests/*', ':!**/__tests__/*',
  ':!docs/*', ':!*.md',
];

let failed = false;

for (const pattern of patterns) {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-nE', pattern, '--', '.', ...pathExcludes],
      { encoding: 'utf8' }
    );
    if (out.trim()) {
      console.log(`\n❌ Potential secret found matching ${pattern}:`);
      console.log(out.trim());
      failed = true;
    }
  } catch (err) {
    // git grep exits 1 when there are no matches - not an error.
    if (err.status !== 1) {
      console.error(`git grep failed for pattern ${pattern}: ${err.message}`);
    }
  }
}

if (failed) {
  console.log('\nSecret scan FAILED - rotate the exposed key and remove it from source.');
  process.exit(1);
}

console.log('NO SECRETS FOUND IN SOURCE FILES');
