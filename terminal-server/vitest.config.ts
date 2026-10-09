import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Surface failing tests as GitHub annotations (readable without log access).
    reporters: process.env.GITHUB_ACTIONS ? ["default", "github-actions"] : ["default"],
    include: ["__tests__/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
