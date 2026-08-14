import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Next.js/React Compiler strict rules. Disable for now while the codebase
  // is progressively refactored to event-handler-driven state updates.
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Dependencies and build output
    "node_modules/**",
    ".next/**",
    ".vercel/**",
    "supabase/.temp/**",
    "out/**",
    "build/**",
    "**/dist/**",
    "next-env.d.ts",
    // Git worktrees — local only, 376K files
    ".worktrees/**",
    ".codex-deploy-stage*/**",
    // Test artifacts
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    // Local binaries and heavy folders
    "chrome/**",
    "terminal-server/**",
    "**/terminal-server/**",
    "Zoo-Code/**",
    // Generated / copied
    "public/**",
    "**/public/**",
    "*.lock",
    "pnpm-lock.yaml",
    // Consolidation scratch copies
    "work/**",
    ".codex-reference/**",
    // Local artifact directories
    "litlabs/**",
    "litlabs-website/**",
    "OmniRoute/**",
    // Docs — not linted
    "docs/**",
    // CommonJS scripts — require() is correct in .cjs and .js files
    "scripts/**/*.cjs",
    "scripts/**/*.js",
    // Root level JS scripts and debug artifacts
    "*.js",
    "scripts/__smoke*.mjs",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Test files: relax `no-explicit-any` to warn (mocks often need any)
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
