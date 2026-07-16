import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
