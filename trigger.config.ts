import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Trigger.dev project ref — set per environment, never committed.
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_unconfigured",
  dirs: ["./src/trigger"],
  maxDuration: 60,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      randomize: true,
    },
  },
});
