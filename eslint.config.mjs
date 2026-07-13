import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Dependencies and build output
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    // Local binaries and heavy folders
    "chrome/**",
    "terminal-server/**",
    "Zoo-Code/**",
    // Generated / copied
    "public/**",
    "*.lock",
    "pnpm-lock.yaml",
    // Consolidation scratch copies
    "work/**",
    ".codex-reference/**",
    // Local artifact directories
    "litlabs/**",
  ]),
]);

export default eslintConfig;
