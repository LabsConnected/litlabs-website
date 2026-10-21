/**
 * android.* tool family — validated, allowlisted ADB operations exposed
 * to the ExecutionGateway.
 *
 * Policy mapping (existing gateway behavior — no parallel system):
 *   readOnly tools (devices, device_state)
 *     → allow in PLAN/ACT/AUTO
 *   mutating tools (screenshot, tap, swipe, key, text, open_app,
 *   push, pull)
 *     → deny in PLAN, require_approval in ACT and AUTO
 *     → AUTO+headless denies via SEC-4 (no manufactured approval)
 *
 * The tool handlers never decide trust — they validate arguments and
 * the device allowlist, then report honest outcomes.
 */

import type { ToolDefinition, ToolEntry, ToolHandler, ToolMetadata, ToolResult } from "@litt/agent-core";
import { createAndroidOps, type AndroidOpsDeps, type OpOutcome } from "./ops.js";
import type { AndroidPolicy } from "./device-registry.js";

export interface AndroidToolDeps {
  /** Policy provider (defaults to the cached android.json loader). */
  policyProvider?: () => AndroidPolicy;
  /** Explicit adb path. */
  adbPath?: string | null;
  /** Env lookup. */
  env?: (key: string) => string | undefined;
  /** PATH lookup. */
  which?: (command: string) => string | null;
  /** State-home override. */
  littHome?: string;
  /** Extra op-level deps (tests inject fs fakes + sleep). */
  opsDeps?: Partial<AndroidOpsDeps>;
}

const READ_ONLY_META: ToolMetadata = { projectScoped: false, mutating: false, readOnly: true };
const MUTATING_META: ToolMetadata = { projectScoped: false, mutating: true, readOnly: false };

function toToolResult(o: OpOutcome): ToolResult {
  return {
    status: o.status,
    success: o.ok,
    message: o.message,
    data: { ...o.data, verified: o.verified },
  };
}

/**
 * Build the android.* ToolEntry map for ToolRegistry.
 * Pass the result as the ToolRegistry constructor's `initial` entries —
 * they merge with (never replace) the default project.* tools.
 */
export function buildAndroidToolEntries(deps: AndroidToolDeps = {}): Record<string, ToolEntry> {
  const opsFor = (shell: AndroidOpsDeps["shell"]) =>
    createAndroidOps({
      shell,
      adbPath: deps.adbPath ?? null,
      env: deps.env,
      which: deps.which,
      littHome: deps.littHome,
      policyProvider: deps.policyProvider,
      ...(deps.opsDeps ?? {}),
    });

  const def = (
    id: string,
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    readOnly: boolean,
  ): ToolDefinition => ({ id, name, description, inputSchema, readOnly });

  const serialProp = {
    serial: {
      type: "string",
      description:
        "Optional adb device serial, exactly as reported by android.devices " +
        "(e.g. 'LBMRAIFEVSNRMFRO' or 'emulator-5554'). Omit it entirely to " +
        "auto-select the sole authorized device — this is the normal case. " +
        "Never pass environment-variable or placeholder names such as " +
        "ANDROID_SERIAL, <serial>, $SERIAL, or %ANDROID_SERIAL% — those " +
        "are rejected, not resolved.",
    },
  };

  const entries: Array<{ def: ToolDefinition; meta: ToolMetadata; handler: ToolHandler }> = [
    {
      def: def("android.devices", "android_devices",
        "List ADB-connected Android devices with state, model, and whether each is authorized (allowlisted) for control. Read-only.",
        { type: "object", properties: {} }, true),
      meta: READ_ONLY_META,
      handler: async (ctx) => toToolResult(await opsFor(ctx.shell).listDevices()),
    },
    {
      def: def("android.device_state", "android_device_state",
        "Inspect an authorized Android device: model, Android version, screen awake/asleep, foreground app, battery. Read-only.",
        { type: "object", properties: { ...serialProp } }, true),
      meta: READ_ONLY_META,
      handler: async (ctx, args) => toToolResult(await opsFor(ctx.shell).deviceState(
        typeof args.serial === "string" ? args.serial : undefined)),
    },
    {
      def: def("android.screenshot", "android_screenshot",
        "Capture a fresh screenshot of the device screen to a PNG under the LiTT captures directory and verify it is a real image. For any request to take, capture, or create a screenshot, you must use this tool; android.pull only transfers an already-existing device file. Privacy-sensitive — requires approval.",
        { type: "object", properties: { ...serialProp, path: { type: "string", description: "Optional local destination inside captures/ or the project dir" } } }, false),
      meta: MUTATING_META,
      handler: async (ctx, args) => toToolResult(await opsFor(ctx.shell).screenshot(
        typeof args.serial === "string" ? args.serial : undefined,
        typeof args.path === "string" ? args.path : undefined)),
    },
    {
      def: def("android.tap", "android_tap",
        "Tap the device screen at pixel coordinates (bounds-checked against the live screen size).",
        { type: "object", properties: { ...serialProp, x: { type: "number" }, y: { type: "number" } } }, false),
      meta: MUTATING_META,
      handler: async (ctx, args) => toToolResult(await opsFor(ctx.shell).tap(
        args.x, args.y, typeof args.serial === "string" ? args.serial : undefined)),
    },
    {
      def: def("android.swipe", "android_swipe",
        "Swipe or scroll on the device screen between two points (bounds-checked, duration 50–5000ms).",
        { type: "object", properties: { ...serialProp, x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" }, durationMs: { type: "number" } } }, false),
      meta: MUTATING_META,
      handler: async (ctx, args) => toToolResult(await opsFor(ctx.shell).swipe(
        args.x1, args.y1, args.x2, args.y2, args.durationMs,
        typeof args.serial === "string" ? args.serial : undefined)),
    },
    {
      def: def("android.key", "android_key",
        "Send a navigation/system key to the device. Allowed: home, back, recents, enter, tab, del, space, up/down/left/right/center, volume_up/down, power, menu, search.",
        { type: "object", properties: { ...serialProp, name: { type: "string" } } }, false),
      meta: MUTATING_META,
      handler: async (ctx, args) => toToolResult(await opsFor(ctx.shell).key(
        // Models commonly emit "key", "keyName", or "keyCode" instead of
        // the declared "name" field — accept aliases rather than failing
        // an otherwise-valid keyevent on a naming mismatch.
        (args.name ?? args.key ?? args.keyName ?? args.keyCode) as string | number | undefined,
        typeof args.serial === "string" ? args.serial : undefined)),
    },
    {
      def: def("android.text", "android_text",
        "Type a short ASCII string into the focused field (max 200 chars; restricted charset — no quotes or shell metacharacters).",
        { type: "object", properties: { ...serialProp, text: { type: "string" } } }, false),
      meta: MUTATING_META,
      handler: async (ctx, args) => toToolResult(await opsFor(ctx.shell).typeText(
        args.text, typeof args.serial === "string" ? args.serial : undefined)),
    },
    {
      def: def("android.open_app", "android_open_app",
        "Launch an allowlisted app by package name (e.g. com.termux) and verify it reaches the foreground.",
        { type: "object", properties: { ...serialProp, package: { type: "string" } } }, false),
      meta: MUTATING_META,
      handler: async (ctx, args) => toToolResult(await opsFor(ctx.shell).openApp(
        args.package, typeof args.serial === "string" ? args.serial : undefined)),
    },
    {
      def: def("android.push", "android_push",
        "Push a local file to the device — confined to /sdcard/LiTT/ with a basename-only remote name. Verified by remote size.",
        { type: "object", properties: { ...serialProp, localPath: { type: "string" }, remoteName: { type: "string" } } }, false),
      meta: MUTATING_META,
      handler: async (ctx, args) => toToolResult(await opsFor(ctx.shell).pushFile(
        args.localPath, args.remoteName, typeof args.serial === "string" ? args.serial : undefined)),
    },
    {
      def: def("android.pull", "android_pull",
        "Transfer an explicitly requested, already-existing file from the device's /sdcard/LiTT/ directory into captures/ or the project dir. This tool never captures a screenshot or creates a remote file: do not invent a remote filename. For a fresh screenshot request, use android.screenshot instead.",
        { type: "object", properties: { ...serialProp, remoteName: { type: "string" }, destDir: { type: "string" } } }, false),
      meta: MUTATING_META,
      handler: async (ctx, args) => toToolResult(await opsFor(ctx.shell).pullFile(
        args.remoteName, args.destDir, typeof args.serial === "string" ? args.serial : undefined)),
    },
  ];

  const out: Record<string, ToolEntry> = {};
  for (const e of entries) {
    out[e.def.id] = { definition: e.def, handler: e.handler, metadata: e.meta };
  }
  return out;
}
