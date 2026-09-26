import { defineConfig } from "vitest/config";

export default defineConfig({
  css: {
    // Node-side unit tests never render CSS — don't load the repo-root
    // PostCSS pipeline (Tailwind/lightningcss native bindings) when vite
    // walks up for a config.
    postcss: { plugins: [] },
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
