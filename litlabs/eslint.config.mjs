import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "terminal-server/dist/**",
  ]),
  // Temporary: disable rules that are too noisy on the existing codebase.
  // These are tracked as tech debt to fix properly (react-hooks/set-state-in-effect,
  // react-hooks/static-components, react-hooks/immutability, and
  // react-hooks/preserve-manual-memoization violations across many client
  // hooks/components).
  {
    rules: {
      "react-compiler/react-compiler": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
]);

export default eslintConfig;