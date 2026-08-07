/**
 * Business Operations — Type Definitions
 *
 * myAIOS is the business-operations capability of LiTT. It is NOT a
 * reasoning brain — it handles service catalogs, pricing, bookings,
 * leads, staff schedules, and business configuration. LiTT decides when
 * business-operations tools are needed.
 *
 * Server-only. Never imported by client components.
 */

// ─── Business Config ────────────────────────────────────────────────

export interface BusinessConfig {
  id: string;
  owner_id: string;
  business_name: string | null;
  business_description: string | null;
  timezone: string;
  currency: string;
  booking_lead_hours: number;
  booking_buffer_minutes: number;
  cancellation_policy_hours: number;
  require_payment_for_booking: boolean;
  allow_rescheduling: boolean;
  notification_email: string | null;
  notification_phone: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Services ───────────────────────────────────────────────────────

export interface BusinessService {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  is_active: boolean;
  category: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Bookings ───────────────────────────────────────────────────────

export type BookingStatus =
  | "pending"
  | "pending_payment"
  | "confirmed"
  | "rescheduled"
  | "cancelled"
  | "completed"
  | "no_show"
  | "failed";

export interface BusinessBooking {
  id: string;
  owner_id: string;
  service_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  start_time: string; // ISO 8601
  end_time: string; // ISO 8601
  status: BookingStatus;
  price_cents: number;
  idempotency_key: string | null;
  stripe_payment_intent_id: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Leads ──────────────────────────────────────────────────────────

export type LeadStatus = "new" | "qualified" | "contacted" | "converted" | "lost";

export interface BusinessLead {
  id: string;
  owner_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: LeadStatus;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Escalations ────────────────────────────────────────────────────

export type EscalationStatus = "open" | "in_progress" | "resolved" | "closed";
export type EscalationPriority = "low" | "medium" | "high" | "urgent";

export interface BusinessEscalation {
  id: string;
  owner_id: string;
  booking_id: string | null;
  lead_id: string | null;
  subject: string;
  description: string;
  status: EscalationStatus;
  priority: EscalationPriority;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Staff Hours ────────────────────────────────────────────────────

export interface StaffHours {
  id: string;
  owner_id: string;
  staff_name: string;
  day_of_week: number; // 0 = Sunday, 6 = Saturday
  start_time: string; // HH:mm
  end_time: string; // HH:mm
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Typed API Responses ────────────────────────────────────────────

export interface BusinessResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status: number;
}

export interface AvailabilitySlot {
  start_time: string;
  end_time: string;
  available: boolean;
}

// ─── Tool Risk Levels ───────────────────────────────────────────────

export type ToolRisk = "low" | "medium" | "high";
export type ApprovalPolicy = "none" | "explicit" | "strong_confirmation";

export interface ToolDefinition {
  id: string;
  category: "business";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredPermissions: string[];
  risk: ToolRisk;
  approvalPolicy: ApprovalPolicy;
  timeoutMs: number;
  idempotent: boolean;
  auditEvent: string;
  handler: (input: unknown, ctx: ToolContext) => Promise<BusinessResult<unknown>>;
}

export interface ToolContext {
  ownerId: string;
  clerkId: string | null;
  conversationId: string | null;
  projectId: string | null;
}
