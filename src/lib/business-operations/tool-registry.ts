/**
 * Business Operations — Granular Tool Registry
 *
 * Replaces the single generic "myaios" tool with explicit, granular tools.
 * Each tool defines: input schema, output schema, required permissions,
 * risk level, approval policy, timeout, idempotency behavior, audit event,
 * and handler.
 *
 * Read tools: no approval required (low risk).
 * Mutation tools: explicit approval required.
 * Destructive tools (delete, cancel, price changes): explicit approval.
 *
 * A tool definition without a handler must NOT be advertised as working.
 */

import type { ToolDefinition, ToolContext, BusinessResult } from "./types";
import {
  getBusinessConfig,
  updateBusinessConfig,
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  checkAvailability,
  createBooking,
  getBooking,
  findBookings,
  rescheduleBooking,
  cancelBooking,
  createLead,
  updateLead,
  createEscalation,
  getStaffHours,
  updateStaffHours,
  getDashboard,
  recordAudit,
} from "./operations";

// ─── Read Tools (no approval required) ──────────────────────────────

const businessConfigRead: ToolDefinition = {
  id: "business.config.read",
  category: "business",
  name: "Read Business Config",
  description: "Read the business configuration (name, timezone, currency, booking policies).",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:read"],
  risk: "low",
  approvalPolicy: "none",
  timeoutMs: 5000,
  idempotent: true,
  auditEvent: "business.config.read",
  handler: async (_input, ctx) => {
    const result = await getBusinessConfig(ctx.ownerId);
    if (!result.ok) return result;
    void recordAudit({ ownerId: ctx.ownerId, toolId: "business.config.read", action: "read", conversationId: ctx.conversationId ?? undefined, projectId: ctx.projectId ?? undefined });
    return result;
  },
};

const businessServicesList: ToolDefinition = {
  id: "business.services.list",
  category: "business",
  name: "List Services",
  description: "List all business services (optionally active only).",
  inputSchema: { type: "object", properties: { activeOnly: { type: "boolean" } } },
  outputSchema: { type: "array" },
  requiredPermissions: ["business:read"],
  risk: "low",
  approvalPolicy: "none",
  timeoutMs: 5000,
  idempotent: true,
  auditEvent: "business.services.list",
  handler: async (input, ctx) => {
    const activeOnly = (input as { activeOnly?: boolean })?.activeOnly ?? false;
    return listServices(ctx.ownerId, activeOnly);
  },
};

const businessServicesGet: ToolDefinition = {
  id: "business.services.get",
  category: "business",
  name: "Get Service",
  description: "Get a single business service by ID.",
  inputSchema: { type: "object", properties: { serviceId: { type: "string" } }, required: ["serviceId"] },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:read"],
  risk: "low",
  approvalPolicy: "none",
  timeoutMs: 5000,
  idempotent: true,
  auditEvent: "business.services.get",
  handler: async (input, ctx) => {
    const { serviceId } = input as { serviceId: string };
    return getService(ctx.ownerId, serviceId);
  },
};

const businessBookingsGet: ToolDefinition = {
  id: "business.bookings.get",
  category: "business",
  name: "Get Booking",
  description: "Get a single booking by ID.",
  inputSchema: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"] },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:read"],
  risk: "low",
  approvalPolicy: "none",
  timeoutMs: 5000,
  idempotent: true,
  auditEvent: "business.bookings.get",
  handler: async (input, ctx) => {
    const { bookingId } = input as { bookingId: string };
    return getBooking(ctx.ownerId, bookingId);
  },
};

const businessBookingsFind: ToolDefinition = {
  id: "business.bookings.find",
  category: "business",
  name: "Find Bookings",
  description: "Find bookings by status, service, or date range.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "pending_payment", "confirmed", "rescheduled", "cancelled", "completed", "no_show", "failed"] },
      serviceId: { type: "string" },
      fromDate: { type: "string" },
      toDate: { type: "string" },
    },
  },
  outputSchema: { type: "array" },
  requiredPermissions: ["business:read"],
  risk: "low",
  approvalPolicy: "none",
  timeoutMs: 5000,
  idempotent: true,
  auditEvent: "business.bookings.find",
  handler: async (input, ctx) => {
    return findBookings(ctx.ownerId, (input as Record<string, string>) ?? {});
  },
};

const businessBookingsAvailability: ToolDefinition = {
  id: "business.bookings.availability",
  category: "business",
  name: "Check Availability",
  description: "Check available time slots for a given date range. Fail-closed: returns no slots if the check fails.",
  inputSchema: {
    type: "object",
    properties: { startTime: { type: "string" }, endTime: { type: "string" } },
    required: ["startTime", "endTime"],
  },
  outputSchema: { type: "array" },
  requiredPermissions: ["business:read"],
  risk: "low",
  approvalPolicy: "none",
  timeoutMs: 5000,
  idempotent: true,
  auditEvent: "business.bookings.availability",
  handler: async (input, ctx) => {
    const { startTime, endTime } = input as { startTime: string; endTime: string };
    return checkAvailability(ctx.ownerId, startTime, endTime);
  },
};

const businessDashboardRead: ToolDefinition = {
  id: "business.dashboard.read",
  category: "business",
  name: "Read Dashboard",
  description: "Get the business dashboard summary (service count, active bookings, pending leads, open escalations).",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:read"],
  risk: "low",
  approvalPolicy: "none",
  timeoutMs: 10000,
  idempotent: true,
  auditEvent: "business.dashboard.read",
  handler: async (_input, ctx) => getDashboard(ctx.ownerId),
};

const businessStaffHoursRead: ToolDefinition = {
  id: "business.staff_hours.read",
  category: "business",
  name: "Read Staff Hours",
  description: "Read staff working hours schedule.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "array" },
  requiredPermissions: ["business:read"],
  risk: "low",
  approvalPolicy: "none",
  timeoutMs: 5000,
  idempotent: true,
  auditEvent: "business.staff_hours.read",
  handler: async (_input, ctx) => getStaffHours(ctx.ownerId),
};

// ─── Mutation Tools (explicit approval required) ────────────────────

const businessConfigUpdate: ToolDefinition = {
  id: "business.config.update",
  category: "business",
  name: "Update Business Config",
  description: "Update business configuration (name, timezone, policies). Requires approval.",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "medium",
  approvalPolicy: "explicit",
  timeoutMs: 5000,
  idempotent: false,
  auditEvent: "business.config.update",
  handler: async (input, ctx) => {
    const result = await updateBusinessConfig(ctx.ownerId, input as Parameters<typeof updateBusinessConfig>[1]);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.config.update",
      action: "update",
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessServicesCreate: ToolDefinition = {
  id: "business.services.create",
  category: "business",
  name: "Create Service",
  description: "Create a new business service. Requires approval.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" }, description: { type: "string" }, duration_minutes: { type: "number" }, price_cents: { type: "number" }, category: { type: "string" } },
    required: ["name", "duration_minutes"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "medium",
  approvalPolicy: "explicit",
  timeoutMs: 5000,
  idempotent: false,
  auditEvent: "business.services.create",
  handler: async (input, ctx) => {
    const result = await createService(ctx.ownerId, input as Parameters<typeof createService>[1]);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.services.create",
      action: "create",
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessServicesUpdate: ToolDefinition = {
  id: "business.services.update",
  category: "business",
  name: "Update Service",
  description: "Update an existing service (name, price, duration, active). Requires approval.",
  inputSchema: { type: "object", properties: { serviceId: { type: "string" } }, required: ["serviceId"] },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "medium",
  approvalPolicy: "explicit",
  timeoutMs: 5000,
  idempotent: false,
  auditEvent: "business.services.update",
  handler: async (input, ctx) => {
    const { serviceId, ...patch } = input as { serviceId: string; [key: string]: unknown };
    const result = await updateService(ctx.ownerId, serviceId, patch as Parameters<typeof updateService>[2]);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.services.update",
      action: "update",
      targetId: serviceId,
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessServicesDelete: ToolDefinition = {
  id: "business.services.delete",
  category: "business",
  name: "Delete Service",
  description: "Delete a business service. Requires approval.",
  inputSchema: { type: "object", properties: { serviceId: { type: "string" } }, required: ["serviceId"] },
  outputSchema: { type: "boolean" },
  requiredPermissions: ["business:write"],
  risk: "high",
  approvalPolicy: "explicit",
  timeoutMs: 5000,
  idempotent: true,
  auditEvent: "business.services.delete",
  handler: async (input, ctx) => {
    const { serviceId } = input as { serviceId: string };
    const result = await deleteService(ctx.ownerId, serviceId);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.services.delete",
      action: "delete",
      targetId: serviceId,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessBookingsCreate: ToolDefinition = {
  id: "business.bookings.create",
  category: "business",
  name: "Create Booking",
  description: "Create a booking atomically (checks availability + creates in one transaction). Supports idempotency. Requires approval.",
  inputSchema: {
    type: "object",
    properties: {
      service_id: { type: "string" },
      customer_name: { type: "string" },
      customer_email: { type: "string" },
      customer_phone: { type: "string" },
      start_time: { type: "string" },
      end_time: { type: "string" },
      idempotency_key: { type: "string" },
      notes: { type: "string" },
    },
    required: ["service_id", "customer_name", "start_time", "end_time"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "medium",
  approvalPolicy: "explicit",
  timeoutMs: 10000,
  idempotent: true,
  auditEvent: "business.bookings.create",
  handler: async (input, ctx) => {
    const result = await createBooking(ctx.ownerId, input as Parameters<typeof createBooking>[1]);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.bookings.create",
      action: "create",
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessBookingsReschedule: ToolDefinition = {
  id: "business.bookings.reschedule",
  category: "business",
  name: "Reschedule Booking",
  description: "Reschedule a booking to a new time. Checks availability first. Requires approval.",
  inputSchema: {
    type: "object",
    properties: { bookingId: { type: "string" }, newStartTime: { type: "string" }, newEndTime: { type: "string" } },
    required: ["bookingId", "newStartTime", "newEndTime"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "medium",
  approvalPolicy: "explicit",
  timeoutMs: 10000,
  idempotent: false,
  auditEvent: "business.bookings.reschedule",
  handler: async (input, ctx) => {
    const { bookingId, newStartTime, newEndTime } = input as { bookingId: string; newStartTime: string; newEndTime: string };
    const result = await rescheduleBooking(ctx.ownerId, bookingId, newStartTime, newEndTime);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.bookings.reschedule",
      action: "reschedule",
      targetId: bookingId,
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessBookingsCancel: ToolDefinition = {
  id: "business.bookings.cancel",
  category: "business",
  name: "Cancel Booking",
  description: "Cancel a booking. Requires approval.",
  inputSchema: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"] },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "high",
  approvalPolicy: "explicit",
  timeoutMs: 5000,
  idempotent: true,
  auditEvent: "business.bookings.cancel",
  handler: async (input, ctx) => {
    const { bookingId } = input as { bookingId: string };
    const result = await cancelBooking(ctx.ownerId, bookingId);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.bookings.cancel",
      action: "cancel",
      targetId: bookingId,
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessLeadsCreate: ToolDefinition = {
  id: "business.leads.create",
  category: "business",
  name: "Create Lead",
  description: "Create a new lead. Requires approval.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, source: { type: "string" }, notes: { type: "string" } },
    required: ["name"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "low",
  approvalPolicy: "explicit",
  timeoutMs: 5000,
  idempotent: false,
  auditEvent: "business.leads.create",
  handler: async (input, ctx) => {
    const result = await createLead(ctx.ownerId, input as Parameters<typeof createLead>[1]);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.leads.create",
      action: "create",
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessLeadsUpdate: ToolDefinition = {
  id: "business.leads.update",
  category: "business",
  name: "Update Lead",
  description: "Update a lead (status, notes, contact info). Requires approval.",
  inputSchema: { type: "object", properties: { leadId: { type: "string" } }, required: ["leadId"] },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "low",
  approvalPolicy: "explicit",
  timeoutMs: 5000,
  idempotent: false,
  auditEvent: "business.leads.update",
  handler: async (input, ctx) => {
    const { leadId, ...patch } = input as { leadId: string; [key: string]: unknown };
    const result = await updateLead(ctx.ownerId, leadId, patch as Parameters<typeof updateLead>[2]);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.leads.update",
      action: "update",
      targetId: leadId,
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessEscalationsCreate: ToolDefinition = {
  id: "business.escalations.create",
  category: "business",
  name: "Create Escalation",
  description: "Create an escalation for a booking or lead issue. Requires approval.",
  inputSchema: {
    type: "object",
    properties: { subject: { type: "string" }, description: { type: "string" }, booking_id: { type: "string" }, lead_id: { type: "string" }, priority: { type: "string" } },
    required: ["subject", "description"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "low",
  approvalPolicy: "explicit",
  timeoutMs: 5000,
  idempotent: false,
  auditEvent: "business.escalations.create",
  handler: async (input, ctx) => {
    const result = await createEscalation(ctx.ownerId, input as Parameters<typeof createEscalation>[1]);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.escalations.create",
      action: "create",
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

const businessStaffHoursUpdate: ToolDefinition = {
  id: "business.staff_hours.update",
  category: "business",
  name: "Update Staff Hours",
  description: "Update staff working hours. Requires approval.",
  inputSchema: { type: "object", properties: { staffHoursId: { type: "string" } }, required: ["staffHoursId"] },
  outputSchema: { type: "object" },
  requiredPermissions: ["business:write"],
  risk: "medium",
  approvalPolicy: "explicit",
  timeoutMs: 5000,
  idempotent: false,
  auditEvent: "business.staff_hours.update",
  handler: async (input, ctx) => {
    const { staffHoursId, ...patch } = input as { staffHoursId: string; [key: string]: unknown };
    const result = await updateStaffHours(ctx.ownerId, staffHoursId, patch as Parameters<typeof updateStaffHours>[2]);
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId: "business.staff_hours.update",
      action: "update",
      targetId: staffHoursId,
      afterState: result.data as Record<string, unknown> | undefined,
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
      result: result.ok ? "success" : "error",
      errorMessage: result.error,
    });
    return result as BusinessResult<unknown>;
  },
};

// ─── Registry ───────────────────────────────────────────────────────

export const BUSINESS_TOOLS: Record<string, ToolDefinition> = {
  // Read tools
  "business.config.read": businessConfigRead,
  "business.services.list": businessServicesList,
  "business.services.get": businessServicesGet,
  "business.bookings.get": businessBookingsGet,
  "business.bookings.find": businessBookingsFind,
  "business.bookings.availability": businessBookingsAvailability,
  "business.dashboard.read": businessDashboardRead,
  "business.staff_hours.read": businessStaffHoursRead,
  // Mutation tools
  "business.config.update": businessConfigUpdate,
  "business.services.create": businessServicesCreate,
  "business.services.update": businessServicesUpdate,
  "business.services.delete": businessServicesDelete,
  "business.bookings.create": businessBookingsCreate,
  "business.bookings.reschedule": businessBookingsReschedule,
  "business.bookings.cancel": businessBookingsCancel,
  "business.leads.create": businessLeadsCreate,
  "business.leads.update": businessLeadsUpdate,
  "business.escalations.create": businessEscalationsCreate,
  "business.staff_hours.update": businessStaffHoursUpdate,
};

export function getBusinessTool(toolId: string): ToolDefinition | null {
  return BUSINESS_TOOLS[toolId] ?? null;
}

export function listBusinessToolIds(): string[] {
  return Object.keys(BUSINESS_TOOLS);
}

/**
 * Execute a business tool by ID. Enforces the approval policy — if the
 * tool requires approval and no approvalId is supplied, the tool is NOT
 * executed and a "needs approval" result is returned.
 */
export async function executeBusinessTool(
  toolId: string,
  input: unknown,
  ctx: ToolContext,
  approvalId?: string,
): Promise<BusinessResult<unknown>> {
  const tool = getBusinessTool(toolId);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${toolId}`, status: 404 };
  }

  // Approval gate
  if (tool.approvalPolicy !== "none" && !approvalId) {
    void recordAudit({
      ownerId: ctx.ownerId,
      toolId,
      action: "execute",
      result: "denied",
      errorMessage: "Approval required but not provided",
      conversationId: ctx.conversationId ?? undefined,
      projectId: ctx.projectId ?? undefined,
    });
    return {
      ok: false,
      error: `Tool ${toolId} requires approval. Provide an approvalId.`,
      status: 403,
    };
  }

  return tool.handler(input, ctx);
}
