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
    "out/**",
    "build/**",
    "**/dist/**",
    "next-env.d.ts",
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
]);

export default eslintConfig;
