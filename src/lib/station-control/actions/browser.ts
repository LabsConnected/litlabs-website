/**
 * Station Control — Browser Station Actions
 *
 * Typed actions for the browser station. Uses the existing browser-job system.
 */

import { z } from "zod";
import { registerStationAction } from "../registry";
import type { StationAction } from "../types";

// ─── Browser Navigate Action ──────────────────────────────────────

const browserNavigateArgsSchema = z.object({
  projectId: z.string().optional(),
  url: z.string().url(),
  waitUntil: z.enum(["idle", "networkidle", "domcontentloaded"]).optional(),
});

const browserNavigateResultSchema = z.object({
  jobId: z.string(),
  liveViewUrl: z.string().optional(),
});

export const browserNavigateAction: StationAction<
  typeof browserNavigateArgsSchema,
  z.infer<typeof browserNavigateResultSchema>
> = {
  id: "browser.navigate",
  station: "browser",
  description: "Navigate browser to a URL",
  mutating: true,
  argsSchema: browserNavigateArgsSchema,
  resultType: browserNavigateResultSchema,
  execute: async () => {
    // The browser-jobs system currently only supports GHL workflow job types.
    // Browser navigation/screenshot job types are not yet implemented.
    throw new Error("browser.navigate: Not implemented — browser job types not yet supported");
  },
};

// ─── Browser Screenshot Action ──────────────────────────────────────

const browserScreenshotArgsSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
  selector: z.string().optional(),
  fullPage: z.boolean().optional(),
});

const browserScreenshotResultSchema = z.object({
  screenshotUrl: z.string(),
});

export const browserScreenshotAction: StationAction<
  typeof browserScreenshotArgsSchema,
  z.infer<typeof browserScreenshotResultSchema>
> = {
  id: "browser.screenshot",
  station: "browser",
  description: "Take a screenshot of the browser",
  mutating: false,
  argsSchema: browserScreenshotArgsSchema,
  resultType: browserScreenshotResultSchema,
  execute: async () => {
    // The browser-jobs system currently only supports GHL workflow job types.
    // Browser navigation/screenshot job types are not yet implemented.
    throw new Error("browser.screenshot: Not implemented — browser job types not yet supported");
  },
};

// Register the actions
registerStationAction(browserNavigateAction);
registerStationAction(browserScreenshotAction);
