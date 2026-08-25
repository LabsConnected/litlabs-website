/**
 * Station Control — Browser Station Actions
 *
 * Typed actions for the browser station. Uses the existing browser-job system.
 */

import { z } from "zod";
import { registerStationAction } from "../registry";
import type { StationAction } from "../types";
import {
  createBrowserJob,
  getJob,
  approveJob,
  cancelJob,
} from "@/lib/browser-jobs";

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
  execute: async (args, ctx) => {
    const result = await createBrowserJob({
      userId: ctx.userId,
      projectId: args.projectId,
      jobType: "browser.navigate",
      params: {
        url: args.url,
        waitUntil: args.waitUntil ?? "networkidle",
      },
    });
    return {
      jobId: result.id,
      liveViewUrl: result.liveViewUrl,
    };
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
  execute: async (args, ctx) => {
    // Submit screenshot job
    const result = await createBrowserJob({
      userId: ctx.userId,
      jobType: "browser.screenshot",
      params: {
        jobId: args.jobId,
        selector: args.selector,
        fullPage: args.fullPage ?? true,
      },
    });
    // For screenshot, we return the job ID for polling
    return { screenshotUrl: result.liveViewUrl ?? "" };
  },
};

// Register the actions
registerStationAction(browserNavigateAction);
registerStationAction(browserScreenshotAction);