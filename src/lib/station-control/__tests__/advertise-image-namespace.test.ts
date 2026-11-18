/**
 * Round 11, Fix 1 — the image result-id namespace collision.
 *
 * The agent loop contains TWO image systems (round-11 diagnosis Q1):
 * - the image.generate TOOL returns provider ids (`pollinations_<ts>`)
 *   and its registry auto-insert already saves the file into the project;
 * - the station image actions keep their own result store
 *   (creator-state `lastResults`, `img_<requestId>` ids) which ONLY the
 *   station image.generate populates.
 *
 * The station generate loses the tool-registry collision to the tool, so
 * in the loop the store can never be populated — yet image.saveAsset /
 * image.selectResult / image.sendToCanvas (which resolve ids ONLY from
 * that store) were advertised, and every saveAsset call failed
 * deterministically ("not a known result id and not a public URL"),
 * burning an approval round-trip on every media run.
 *
 * These tests pin the fix: the result consumers are NOT advertised to
 * the loop while the loop's generate is the tool — and the station/UI
 * path, whose generate DOES populate the store, keeps working.
 */
import { describe, it, expect, vi } from "vitest";

/* Registers all station actions AND the real tool registry. Does NOT
 * advertise — advertisement happens explicitly below. */
import "../index";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import { getStationAction } from "../registry";
import { executeStationAction } from "../executor";
import { buildStationContext } from "../project-session";
import { registerAllStationActions } from "../index";
import { creatorKey, pushCreatorResult } from "../stations/creator-state";
import type { StationExecutionContext } from "../types";

const RESULT_CONSUMERS = ["image.selectResult", "image.saveAsset", "image.sendToCanvas"];

describe("image result consumers are not advertised to the agent loop", () => {
  it("the tool image.generate holds the registry id before sync (the collision)", () => {
    expect(toolRegistry.get("image.generate")).toBeDefined();
    for (const id of RESULT_CONSUMERS) {
      expect(toolRegistry.get(id), id).toBeUndefined();
    }
  });

  it("sync does not advertise the consumers, and keeps the original generate tool", () => {
    const originalGenerate = toolRegistry.get("image.generate");
    registerAllStationActions();
    // Idempotent: a second sync must not change the outcome.
    registerAllStationActions();

    for (const id of RESULT_CONSUMERS) {
      expect(toolRegistry.get(id), id).toBeUndefined();
    }
    const enabledIds = new Set(toolRegistry.listEnabled().map((t) => t.id));
    for (const id of RESULT_CONSUMERS) {
      expect(enabledIds.has(id), id).toBe(false);
    }
    // The pre-existing tool keeps its advertisement (additive rule).
    expect(toolRegistry.get("image.generate")).toBe(originalGenerate);
  });

  it("other image station actions the loop can use stay advertised", () => {
    registerAllStationActions();
    expect(toolRegistry.get("image.setPrompt")).toBeDefined();
    expect(toolRegistry.get("image.setStyle")).toBeDefined();
  });

  it("the station actions themselves remain registered for station/UI callers", () => {
    for (const id of RESULT_CONSUMERS) {
      expect(getStationAction(id), id).toBeDefined();
    }
    expect(getStationAction("image.generate")).toBeDefined();
  });
});

describe("station path: saveAsset still resolves station-generated results", () => {
  function makeCtx(): StationExecutionContext {
    return buildStationContext({
      userId: "user-namespace",
      conversationId: "conv-namespace",
      projectId: "proj-namespace",
      hasApproval: true,
      emitEvent: () => undefined,
    });
  }

  it("saveAsset saves a result the station generate pushed (img_ id)", async () => {
    const ctx = makeCtx();
    // Exactly what the station image.generate does on success.
    pushCreatorResult(creatorKey(ctx), {
      id: "img_req-1",
      url: "https://images.example/lion.png",
      kind: "image",
    });
    const spy = vi
      .spyOn(toolRegistry, "execute")
      .mockImplementation(async (id: string) => {
        if (id === "project.insert_asset") {
          return { ok: true, result: { success: true, sitePath: "/assets/images/lion.png" } } as never;
        }
        return { ok: false, error: `unexpected tool ${id}` } as never;
      });
    try {
      const res = await executeStationAction(
        "image.saveAsset",
        { resultId: "img_req-1" },
        ctx,
      );
      expect(res.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        "project.insert_asset",
        expect.objectContaining({ url: "https://images.example/lion.png" }),
        expect.anything(),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("a provider id from the tool path is still an honest miss on the station path", async () => {
    const ctx = makeCtx();
    const res = await executeStationAction(
      "image.saveAsset",
      { resultId: "pollinations_1794869122578" },
      ctx,
    );
    expect(res.success).toBe(false);
    expect((res as { error?: string }).error).toMatch(/not a known result id/);
  });
});
