/**
 * Business Operations — Tool Registry tests.
 *
 * Verifies the granular tool definitions, approval policies, risk
 * levels, and the approval gate in executeBusinessTool.
 *
 * Run: npx vitest run src/lib/business-operations/business-operations.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  getBusinessTool,
  listBusinessToolIds,
  executeBusinessTool,
} from "./tool-registry";
import type { ToolContext } from "./types";

const ctx: ToolContext = {
  ownerId: "user_test",
  clerkId: "clerk_test",
  conversationId: "conv_test",
  projectId: null,
};

describe("Business Tool Registry — definitions", () => {
  it("registers 19 granular tools", () => {
    expect(listBusinessToolIds()).toHaveLength(19);
  });

  it("every tool has a unique id", () => {
    const ids = listBusinessToolIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every tool has a handler function", () => {
    for (const id of listBusinessToolIds()) {
      const tool = getBusinessTool(id);
      expect(tool).not.toBeNull();
      expect(typeof tool!.handler).toBe("function");
    }
  });

  it("every tool has an audit event", () => {
    for (const id of listBusinessToolIds()) {
      const tool = getBusinessTool(id);
      expect(tool!.auditEvent).toBeTruthy();
    }
  });

  it("read tools have low risk and no approval", () => {
    const readToolIds = [
      "business.config.read",
      "business.services.list",
      "business.services.get",
      "business.bookings.get",
      "business.bookings.find",
      "business.bookings.availability",
      "business.dashboard.read",
      "business.staff_hours.read",
    ];
    for (const id of readToolIds) {
      const tool = getBusinessTool(id);
      expect(tool!.risk).toBe("low");
      expect(tool!.approvalPolicy).toBe("none");
    }
  });

  it("mutation tools require explicit approval", () => {
    const mutationToolIds = [
      "business.config.update",
      "business.services.create",
      "business.services.update",
      "business.services.delete",
      "business.bookings.create",
      "business.bookings.reschedule",
      "business.bookings.cancel",
      "business.leads.create",
      "business.leads.update",
      "business.escalations.create",
      "business.staff_hours.update",
    ];
    for (const id of mutationToolIds) {
      const tool = getBusinessTool(id);
      expect(tool!.approvalPolicy).toBe("explicit");
    }
  });

  it("destructive tools (delete, cancel) are high risk", () => {
    expect(getBusinessTool("business.services.delete")!.risk).toBe("high");
    expect(getBusinessTool("business.bookings.cancel")!.risk).toBe("high");
  });

  it("booking create is idempotent", () => {
    expect(getBusinessTool("business.bookings.create")!.idempotent).toBe(true);
  });

  it("booking create has a timeout of 10s (atomic RPC)", () => {
    expect(getBusinessTool("business.bookings.create")!.timeoutMs).toBe(10000);
  });

  it("all tools have requiredPermissions", () => {
    for (const id of listBusinessToolIds()) {
      const tool = getBusinessTool(id);
      expect(tool!.requiredPermissions.length).toBeGreaterThan(0);
    }
  });

  it("read tools have business:read permission", () => {
    expect(getBusinessTool("business.config.read")!.requiredPermissions).toContain("business:read");
  });

  it("mutation tools have business:write permission", () => {
    expect(getBusinessTool("business.services.create")!.requiredPermissions).toContain("business:write");
  });
});

describe("executeBusinessTool — approval gate", () => {
  it("rejects mutation tools without approvalId", async () => {
    const result = await executeBusinessTool(
      "business.services.create",
      { name: "Test", duration_minutes: 30 },
      ctx,
      // no approvalId
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("requires approval");
  });

  it("rejects cancel without approvalId", async () => {
    const result = await executeBusinessTool(
      "business.bookings.cancel",
      { bookingId: "test-booking" },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("returns 404 for unknown tool", async () => {
    const result = await executeBusinessTool("business.bogus", {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("read tools do not require approval (they still run, hitting DB which may 503)", async () => {
    // Read tools should NOT be blocked by the approval gate.
    // They may fail with 503 if DB is not configured, but the failure
    // should NOT be a 403 "requires approval".
    const result = await executeBusinessTool("business.config.read", {}, ctx);
    expect(result.status).not.toBe(403);
  });
});
