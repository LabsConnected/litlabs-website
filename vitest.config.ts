import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` is a Next.js build-time marker that throws if imported
      // into client bundles. In vitest we just need it to resolve to nothing
      // so modules using it can be imported by tests.
      "server-only": path.resolve(__dirname, "vitest.stubs/empty.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    exclude: [
      "node_modules",
      ".next",
      "OmniRoute",
      "litlabs",
      "litlabs-website",
      "work",
      "Zoo-Code",
      "meta",
    ],
  },
});
