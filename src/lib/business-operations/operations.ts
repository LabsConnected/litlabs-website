/**
 * Business Operations Service
 *
 * myAIOS Business Operations — handles service catalogs, pricing,
 * availability, bookings, leads, staff schedules, escalations, and
 * business configuration. This is business logic, NOT AI orchestration.
 *
 * Server-only. All functions enforce owner_id scoping — never trust
 * arbitrary owner_id input without verifying access (enforced by the
 * caller passing the authenticated Clerk user ID).
 */

import { supabaseAdmin } from "@/lib/supabase";
import type {
  BusinessConfig,
  BusinessService,
  BusinessBooking,
  BusinessLead,
  BusinessEscalation,
  StaffHours,
  BookingStatus,
  EscalationPriority,
  AvailabilitySlot,
  BusinessResult,
} from "./types";

// ─── Helpers ────────────────────────────────────────────────────────

function ok<T>(data: T, status = 200): BusinessResult<T> {
  return { ok: true, data, status };
}

function fail(status: number, error: string): BusinessResult<never> {
  return { ok: false, error, status };
}

function notConfigured(): BusinessResult<never> {
  return { ok: false, error: "Database not configured", status: 503 };
}

// ─── Config ─────────────────────────────────────────────────────────

export async function getBusinessConfig(ownerId: string): Promise<BusinessResult<BusinessConfig>> {
  const { data, error } = await supabaseAdmin
    .from("business_config")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Business config not found");
  return ok(data as BusinessConfig);
}

export async function updateBusinessConfig(
  ownerId: string,
  patch: Partial<Pick<BusinessConfig,
    | "business_name" | "business_description" | "timezone" | "currency"
    | "booking_lead_hours" | "booking_buffer_minutes" | "cancellation_policy_hours"
    | "require_payment_for_booking" | "allow_rescheduling"
    | "notification_email" | "notification_phone" | "settings"
  >>,
): Promise<BusinessResult<BusinessConfig>> {
  const { data, error } = await supabaseAdmin
    .from("business_config")
    .upsert({ owner_id: ownerId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "owner_id" })
    .select()
    .single();

  if (error) return fail(500, error.message);
  return ok(data as BusinessConfig);
}

// ─── Services ───────────────────────────────────────────────────────

export async function listServices(ownerId: string, activeOnly = false): Promise<BusinessResult<BusinessService[]>> {
  let query = supabaseAdmin.from("business_services").select("*").eq("owner_id", ownerId);
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return fail(500, error.message);
  return ok((data || []) as BusinessService[]);
}

export async function getService(ownerId: string, serviceId: string): Promise<BusinessResult<BusinessService>> {
  const { data, error } = await supabaseAdmin
    .from("business_services")
    .select("*")
    .eq("id", serviceId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Service not found");
  return ok(data as BusinessService);
}

export async function createService(
  ownerId: string,
  input: { name: string; description?: string; duration_minutes: number; price_cents?: number; category?: string },
): Promise<BusinessResult<BusinessService>> {
  if (!input.name?.trim()) return fail(400, "name is required");
  if (!input.duration_minutes || input.duration_minutes <= 0) return fail(400, "duration_minutes must be > 0");

  const { data, error } = await supabaseAdmin
    .from("business_services")
    .insert({
      owner_id: ownerId,
      name: input.name,
      description: input.description ?? null,
      duration_minutes: input.duration_minutes,
      price_cents: input.price_cents ?? 0,
      category: input.category ?? null,
    })
    .select()
    .single();
  if (error) return fail(500, error.message);
  return ok(data as BusinessService);
}

export async function updateService(
  ownerId: string,
  serviceId: string,
  patch: Partial<Pick<BusinessService, "name" | "description" | "duration_minutes" | "price_cents" | "is_active" | "category">>,
): Promise<BusinessResult<BusinessService>> {
  const { data, error } = await supabaseAdmin
    .from("business_services")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .eq("owner_id", ownerId)
    .select()
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Service not found");
  return ok(data as BusinessService);
}

export async function deleteService(ownerId: string, serviceId: string): Promise<BusinessResult<boolean>> {
  const { error } = await supabaseAdmin
    .from("business_services")
    .delete()
    .eq("id", serviceId)
    .eq("owner_id", ownerId);
  if (error) return fail(500, error.message);
  return ok(true);
}

// ─── Bookings ───────────────────────────────────────────────────────

/**
 * Check availability for a time range. Fail-closed: if the query fails,
 * return no available slots (do NOT fail open).
 */
export async function checkAvailability(
  ownerId: string,
  startTime: string,
  endTime: string,
): Promise<BusinessResult<AvailabilitySlot[]>> {
  // Get staff hours for the relevant day
  const start = new Date(startTime);
  const dayOfWeek = start.getDay();
  const dateStr = start.toISOString().slice(0, 10);

  const { data: staffHours, error: hoursError } = await supabaseAdmin
    .from("business_staff_hours")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("day_of_week", dayOfWeek)
    .eq("is_available", true);

  if (hoursError) return fail(500, hoursError.message);

  // If no staff hours configured, return empty (fail-closed)
  if (!staffHours || staffHours.length === 0) {
    return ok([]);
  }

  // Check existing bookings in the range
  const { data: existing, error: bookingError } = await supabaseAdmin
    .from("business_bookings")
    .select("start_time, end_time")
    .eq("owner_id", ownerId)
    .in("status", ["pending", "pending_payment", "confirmed", "rescheduled"])
    .gte("start_time", dateStr + "T00:00:00Z")
    .lte("end_time", dateStr + "T23:59:59Z");

  if (bookingError) return fail(500, bookingError.message);

  // Build available slots from staff hours minus existing bookings
  const slots: AvailabilitySlot[] = [];
  for (const hours of staffHours as StaffHours[]) {
    const slotStart = new Date(dateStr + "T" + hours.start_time + ":00");
    const slotEnd = new Date(dateStr + "T" + hours.end_time + ":00");

    // Check if this slot overlaps with the requested range
    if (slotStart >= new Date(endTime) || slotEnd <= new Date(startTime)) continue;

    // Check if it overlaps with any existing booking
    const hasConflict = (existing || []).some((b: { start_time: string; end_time: string }) => {
      const bStart = new Date(b.start_time);
      const bEnd = new Date(b.end_time);
      return bStart < slotEnd && bEnd > slotStart;
    });

    slots.push({
      start_time: slotStart.toISOString(),
      end_time: slotEnd.toISOString(),
      available: !hasConflict,
    });
  }

  return ok(slots);
}

/**
 * Create a booking atomically. Uses the create_booking_atomic RPC which
 * checks availability AND inserts in a single transaction — preventing
 * race conditions. Supports idempotency: retries with the same key
 * return the existing booking instead of creating duplicates.
 */
export async function createBooking(
  ownerId: string,
  input: {
    service_id: string;
    customer_name: string;
    customer_email?: string;
    customer_phone?: string;
    start_time: string;
    end_time: string;
    price_cents?: number;
    idempotency_key?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<BusinessResult<{ booking: BusinessBooking; duplicate: boolean }>> {
  if (!input.service_id) return fail(400, "service_id is required");
  if (!input.customer_name?.trim()) return fail(400, "customer_name is required");
  if (!input.start_time || !input.end_time) return fail(400, "start_time and end_time are required");

  // Resolve the service to get the price if not supplied
  let priceCents = input.price_cents ?? 0;
  if (priceCents === 0) {
    const serviceResult = await getService(ownerId, input.service_id);
    if (serviceResult.ok && serviceResult.data) {
      priceCents = serviceResult.data.price_cents;
    }
  }

  // Use the atomic RPC — checks availability + creates in one transaction
  const { data, error } = await supabaseAdmin.rpc("create_booking_atomic", {
    p_owner_id: ownerId,
    p_service_id: input.service_id,
    p_customer_name: input.customer_name,
    p_customer_email: input.customer_email ?? null,
    p_customer_phone: input.customer_phone ?? null,
    p_start_time: input.start_time,
    p_end_time: input.end_time,
    p_price_cents: priceCents,
    p_idempotency_key: input.idempotency_key ?? null,
    p_notes: input.notes ?? null,
    p_metadata: input.metadata ?? {},
  });

  if (error) return fail(500, error.message);
  if (!data || data.length === 0) {
    // No slot available (fail-closed)
    return fail(409, "Time slot is not available");
  }

  const row = data[0];
  // Fetch the full booking record
  const { data: booking, error: fetchError } = await supabaseAdmin
    .from("business_bookings")
    .select("*")
    .eq("id", row.id)
    .single();

  if (fetchError || !booking) return fail(500, "Booking created but could not be fetched");
  return ok({ booking: booking as BusinessBooking, duplicate: row.duplicate });
}

export async function getBooking(ownerId: string, bookingId: string): Promise<BusinessResult<BusinessBooking>> {
  const { data, error } = await supabaseAdmin
    .from("business_bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Booking not found");
  return ok(data as BusinessBooking);
}

export async function findBookings(
  ownerId: string,
  filters: { status?: BookingStatus; serviceId?: string; fromDate?: string; toDate?: string },
): Promise<BusinessResult<BusinessBooking[]>> {
  let query = supabaseAdmin.from("business_bookings").select("*").eq("owner_id", ownerId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.serviceId) query = query.eq("service_id", filters.serviceId);
  if (filters.fromDate) query = query.gte("start_time", filters.fromDate);
  if (filters.toDate) query = query.lte("start_time", filters.toDate);
  const { data, error } = await query.order("start_time", { ascending: true });
  if (error) return fail(500, error.message);
  return ok((data || []) as BusinessBooking[]);
}

export async function rescheduleBooking(
  ownerId: string,
  bookingId: string,
  newStartTime: string,
  newEndTime: string,
): Promise<BusinessResult<BusinessBooking>> {
  // Check availability for the new slot (excluding this booking)
  const { error: overlapError } = await supabaseAdmin
    .rpc("check_booking_overlap", {
      p_owner_id: ownerId,
      p_start_time: newStartTime,
      p_end_time: newEndTime,
      p_exclude_booking_id: bookingId,
    });

  if (overlapError) return fail(500, overlapError.message);

  // The RPC returns boolean — but supabase-js wraps it. Check if overlap exists.
  const { data: overlapResult } = await supabaseAdmin
    .rpc("check_booking_overlap", {
      p_owner_id: ownerId,
      p_start_time: newStartTime,
      p_end_time: newEndTime,
      p_exclude_booking_id: bookingId,
    });

  if (overlapResult === false) {
    return fail(409, "New time slot conflicts with an existing booking");
  }

  const { data, error } = await supabaseAdmin
    .from("business_bookings")
    .update({
      start_time: newStartTime,
      end_time: newEndTime,
      status: "rescheduled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("owner_id", ownerId)
    .select()
    .maybeSingle();

  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Booking not found");
  return ok(data as BusinessBooking);
}

export async function cancelBooking(ownerId: string, bookingId: string): Promise<BusinessResult<BusinessBooking>> {
  const { data, error } = await supabaseAdmin
    .from("business_bookings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("owner_id", ownerId)
    .select()
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Booking not found");
  return ok(data as BusinessBooking);
}

/**
 * Update booking payment status. Paid bookings are NOT marked confirmed
 * until Stripe confirms payment — this function is called by the Stripe
 * webhook after payment confirmation.
 */
export async function confirmBookingPayment(
  ownerId: string,
  bookingId: string,
  stripePaymentIntentId: string,
): Promise<BusinessResult<BusinessBooking>> {
  const { data, error } = await supabaseAdmin
    .from("business_bookings")
    .update({
      status: "confirmed",
      stripe_payment_intent_id: stripePaymentIntentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("owner_id", ownerId)
    .in("status", ["pending", "pending_payment"]) // only confirm unpaid bookings
    .select()
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Booking not found or already confirmed");
  return ok(data as BusinessBooking);
}

// ─── Leads ──────────────────────────────────────────────────────────

export async function createLead(
  ownerId: string,
  input: { name: string; email?: string; phone?: string; source?: string; notes?: string },
): Promise<BusinessResult<BusinessLead>> {
  if (!input.name?.trim()) return fail(400, "name is required");
  const { data, error } = await supabaseAdmin
    .from("business_leads")
    .insert({
      owner_id: ownerId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      source: input.source ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) return fail(500, error.message);
  return ok(data as BusinessLead);
}

export async function updateLead(
  ownerId: string,
  leadId: string,
  patch: Partial<Pick<BusinessLead, "name" | "email" | "phone" | "source" | "status" | "notes">>,
): Promise<BusinessResult<BusinessLead>> {
  const { data, error } = await supabaseAdmin
    .from("business_leads")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("owner_id", ownerId)
    .select()
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Lead not found");
  return ok(data as BusinessLead);
}

// ─── Escalations ────────────────────────────────────────────────────

export async function createEscalation(
  ownerId: string,
  input: {
    subject: string;
    description: string;
    booking_id?: string;
    lead_id?: string;
    priority?: EscalationPriority;
  },
): Promise<BusinessResult<BusinessEscalation>> {
  if (!input.subject?.trim()) return fail(400, "subject is required");
  if (!input.description?.trim()) return fail(400, "description is required");
  const { data, error } = await supabaseAdmin
    .from("business_escalations")
    .insert({
      owner_id: ownerId,
      subject: input.subject,
      description: input.description,
      booking_id: input.booking_id ?? null,
      lead_id: input.lead_id ?? null,
      priority: input.priority ?? "medium",
    })
    .select()
    .single();
  if (error) return fail(500, error.message);
  return ok(data as BusinessEscalation);
}

// ─── Staff Hours ────────────────────────────────────────────────────

export async function getStaffHours(ownerId: string): Promise<BusinessResult<StaffHours[]>> {
  const { data, error } = await supabaseAdmin
    .from("business_staff_hours")
    .select("*")
    .eq("owner_id", ownerId)
    .order("day_of_week", { ascending: true });
  if (error) return fail(500, error.message);
  return ok((data || []) as StaffHours[]);
}

export async function updateStaffHours(
  ownerId: string,
  staffHoursId: string,
  patch: Partial<Pick<StaffHours, "staff_name" | "day_of_week" | "start_time" | "end_time" | "is_available">>,
): Promise<BusinessResult<StaffHours>> {
  const { data, error } = await supabaseAdmin
    .from("business_staff_hours")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", staffHoursId)
    .eq("owner_id", ownerId)
    .select()
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Staff hours record not found");
  return ok(data as StaffHours);
}

// ─── Dashboard ──────────────────────────────────────────────────────

export interface BusinessDashboard {
  services: number;
  activeBookings: number;
  pendingLeads: number;
  openEscalations: number;
  upcomingBookings: BusinessBooking[];
  recentLeads: BusinessLead[];
}

export async function getDashboard(ownerId: string): Promise<BusinessResult<BusinessDashboard>> {
  const [services, bookings, leads, escalations] = await Promise.all([
    supabaseAdmin.from("business_services").select("id", { count: "exact", head: true }).eq("owner_id", ownerId),
    supabaseAdmin.from("business_bookings").select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId).in("status", ["pending", "pending_payment", "confirmed"]),
    supabaseAdmin.from("business_leads").select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId).eq("status", "new"),
    supabaseAdmin.from("business_escalations").select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId).in("status", ["open", "in_progress"]),
  ]);

  if (services.error || bookings.error || leads.error || escalations.error) {
    return fail(500, "Failed to load dashboard");
  }

  // Get upcoming bookings (next 5)
  const { data: upcoming } = await supabaseAdmin
    .from("business_bookings")
    .select("*")
    .eq("owner_id", ownerId)
    .in("status", ["pending", "pending_payment", "confirmed"])
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(5);

  // Get recent leads (last 5)
  const { data: recentLeads } = await supabaseAdmin
    .from("business_leads")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(5);

  return ok({
    services: services.count ?? 0,
    activeBookings: bookings.count ?? 0,
    pendingLeads: leads.count ?? 0,
    openEscalations: escalations.count ?? 0,
    upcomingBookings: (upcoming || []) as BusinessBooking[],
    recentLeads: (recentLeads || []) as BusinessLead[],
  });
}

// ─── Audit ──────────────────────────────────────────────────────────

export async function recordAudit(args: {
  ownerId: string;
  toolId: string;
  action: string;
  targetId?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  approvalId?: string;
  conversationId?: string;
  projectId?: string;
  result?: "success" | "failed" | "denied" | "error";
  errorMessage?: string;
}): Promise<void> {
  try {
    await supabaseAdmin.from("business_audit_log").insert({
      owner_id: args.ownerId,
      tool_id: args.toolId,
      action: args.action,
      target_id: args.targetId ?? null,
      before_state: args.beforeState ?? null,
      after_state: args.afterState ?? null,
      approval_id: args.approvalId ?? null,
      conversation_id: args.conversationId ?? null,
      project_id: args.projectId ?? null,
      result: args.result ?? "success",
      error_message: args.errorMessage ?? null,
    });
  } catch {
    // audit is best-effort
  }
}

export { notConfigured };
