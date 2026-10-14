import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Offline browser fixture: requires locally installed Playwright Chromium.
// Authentication/storage are fixtures; no cloud browser or model calls occur.
export default defineConfig({ ...base, test: { ...base.test, include: ["tests/preview-static-browser.test.ts"], exclude: [] } });
