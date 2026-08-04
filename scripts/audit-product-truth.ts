#!/usr/bin/env node
/**
 * Product-Truth Alignment Audit Script
 *
 * Scans the repository for obsolete statements and contradictions against
 * the canonical product truth defined in docs/PRODUCT_TRUTH.md and
 * src/config/product-truth.ts.
 *
 * Exits nonzero when contradictions are detected.
 *
 * Usage: pnpm audit:product-truth
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const REPO_ROOT = join(__dirname, "..");
const SCAN_DIRS = [
  "src/app",
  "src/components",
  "src/config",
  "src/lib",
  "src/context",
  "src/stores",
  "tests",
];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "docs/legacy",
]);
const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".md",
  ".json",
  ".css",
  ".txt",
]);

// Files where banned phrases are allowed (archived docs, the audit report
// itself, the product-truth contract which defines what's banned, and test
// files that verify the ban).
const ALLOWED_FILES = new Set([
  "docs/AUDIT_PRODUCT_TRUTH_REPORT.md",
  "docs/PRODUCT_TRUTH.md",
  "docs/ULTRA_BLUEPRINT_v7.md",
  "docs/LITTREE_MASTER_PLATFORM_HANDBOOK_v2.0.md",
  "docs/SUPABASE_LITBITS_BILLING_CHECKLIST.md",
  "docs/legacy",
  "src/config/product-truth.ts",
  "scripts/audit-product-truth.ts",
  "tests/product-truth-consistency.test.ts",
  "tests/playwright/billing.spec.ts", // Tests that $49 does NOT appear
]);

interface Finding {
  file: string;
  line: number;
  phrase: string;
  context: string;
}

const BANNED_PHRASES: string[] = [
  // Pricing — $49 and six-month Founder claims
  "$49",
  "six months",
  "6 months",
  // Founder naming
  "Founding Supporter",
  // Agent model — seven agents
  "seven AI agents",
  "7 AI agents",
  "7 specialist AI agents",
  // LiTTBits — coins terminology
  "coin pack",
  "coin packs",
  "coin-pack",
  // Founder benefits that were invented
  "15% off future credit packs",
  "20% off credit packs",
  "5,000 bonus LiTTBits",
  // Starter monthly claim (it's one-time)
  "500 monthly LiTTBits",
];

function scanDir(dir: string, findings: Finding[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relPath = relative(REPO_ROOT, fullPath).replace(/\\/g, "/");

    // Skip excluded dirs
    if (SKIP_DIRS.has(relPath) || SKIP_DIRS.has(entry)) continue;

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      scanDir(fullPath, findings);
      continue;
    }

    if (!stat.isFile()) continue;
    if (!SCAN_EXTENSIONS.has(extname(fullPath))) continue;

    // Check if this file is in the allowed list
    const isAllowed = ALLOWED_FILES.has(relPath) ||
      Array.from(ALLOWED_FILES).some(allowed => relPath.startsWith(allowed));

    if (isAllowed) continue;

    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const phrase of BANNED_PHRASES) {
        if (line.includes(phrase)) {
          findings.push({
            file: relPath,
            line: i + 1,
            phrase,
            context: line.trim().slice(0, 120),
          });
        }
      }
    }
  }
}

function main(): void {
  const findings: Finding[] = [];

  for (const dir of SCAN_DIRS) {
    scanDir(join(REPO_ROOT, dir), findings);
  }

  if (findings.length === 0) {
    console.log("✅ Product-truth audit passed — no banned phrases found.");
    process.exit(0);
  }

  console.error(`❌ Product-truth audit failed — ${findings.length} contradiction(s) found:\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    Phrase: "${f.phrase}"`);
    console.error(`    Context: ${f.context}`);
    console.error();
  }

  console.error(
    "These phrases contradict the canonical product truth defined in docs/PRODUCT_TRUTH.md.\n" +
    "Remove or replace them. If they appear in archived documentation, move the file to docs/legacy/.\n",
  );

  process.exit(1);
}

main();
