/**
 * LiTT Myaios Brain — Shared Intelligence Layer
 *
 * ONE brain. Multiple interfaces (chat, voice, admin).
 * No duplicated business logic.
 *
 * This module is the single source of truth for:
 *   - Service catalog (with Stripe price mapping)
 *   - Booking management (create, reschedule, cancel, lookup)
 *   - Lead capture + qualification
 *   - Staff availability (separate from 24/7 myaios)
 *   - Human escalation
 *   - Myaios configuration
 *   - Operational analytics events
 *
 * Security: server-only. Uses supabaseAdmin for all DB access.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

// ─── Snake-to-camel mapper ───────────────────────────────────────
// Supabase returns snake_case columns; our TS interfaces use camelCase.
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/gi, (_, c) => c.toUpperCase());
}

function mapConfigRow(row: Record<string, unknown>): MyaiosConfig {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  return out as unknown as MyaiosConfig;
}

function mapServiceRow(row: Record<string, unknown>): MyaiosService {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  return out as unknown as MyaiosService;
}

function mapBookingRow(row: Record<string, unknown>): MyaiosBooking {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  return out as unknown as MyaiosBooking;
}

function mapLeadRow(row: Record<string, unknown>): MyaiosLead {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  return out as unknown as MyaiosLead;
}

function mapEscalationRow(row: Record<string, unknown>): MyaiosEscalation {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  return out as unknown as MyaiosEscalation;
}

// ─── Types ───────────────────────────────────────────────────────

export interface MyaiosConfig {
  id: string;
  ownerId: string;
  businessName: string;
  businessDescription: string;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  location: string | null;
  timezone: string;
  receptionistName: string;
  receptionistVoice: string;
  greeting: string;
  instructions: string | null;
  fallbackBehavior: string;
  myaios247: boolean;
  myaiosHours: Record<string, unknown>;
  bookingRules: Record<string, unknown>;
  cancellationPolicy: string;
  reschedulingPolicy: string;
  confirmationMessage: string;
  reminderSettings: Record<string, unknown>;
  leadRequiredFields: string[];
  leadOptionalFields: string[];
  qualificationQuestions: unknown[];
  escalationContact: string | null;
  escalationRules: Record<string, unknown>;
  emergencyRules: Record<string, unknown>;
  bookingPageSlug: string;
  bookingPageIntro: string;
}

export interface MyaiosService {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  category: string;
  durationMinutes: number;
  priceCents: number | null;
  priceInterval: string | null;
  currency: string;
  priceOnRequest: boolean;
  stripeProductId: string | null;
  stripePriceId: string | null;
  bookable: boolean;
  bookingBufferMinutes: number;
  maxBookingsPerDay: number;
  availableDays: number[];
  availableHoursStart: string;
  availableHoursEnd: string;
  active: boolean;
  sortOrder: number;
  metadata: Record<string, unknown>;
}

export interface MyaiosBooking {
  id: string;
  ownerId: string;
  serviceId: string | null;
  serviceName: string;
  serviceDurationMinutes: number;
  servicePriceCents: number | null;
  servicePriceInterval: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  customerUserId: string | null;
  bookingDate: string;
  bookingTime: string;
  bookingEndTime: string;
  timezone: string;
  status: string;
  stripeCheckoutSessionId: string | null;
  stripePaymentStatus: string | null;
  paymentRequired: boolean;
  notes: string | null;
  metadata: Record<string, unknown>;
  source: string;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyaiosLead {
  id: string;
  ownerId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  interest: string;
  serviceId: string | null;
  serviceName: string | null;
  projectType: string | null;
  budget: string | null;
  timeline: string | null;
  status: string;
  leadScore: number;
  qualificationAnswers: Record<string, unknown>;
  source: string;
  conversationId: string | null;
  followUpDate: string | null;
  followUpNotes: string | null;
  assignedTo: string | null;
  bookingId: string | null;
  userId: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MyaiosEscalation {
  id: string;
  ownerId: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerUserId: string | null;
  reason: string;
  urgency: string;
  intent: string | null;
  relevantService: string | null;
  conversationSummary: string;
  conversationId: string | null;
  requestedAction: string;
  status: string;
  assignedTo: string | null;
  resolutionNotes: string | null;
  leadId: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffHours {
  id: string;
  ownerId: string;
  staffName: string;
  staffRole: string;
  staffUserId: string | null;
  schedule: Record<string, { start?: string; end?: string; available: boolean }>;
  timeOff: unknown[];
  active: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatPrice(cents: number | null, interval: string | null, currency: string, priceOnRequest: boolean): string {
  if (priceOnRequest) return "Price on request";
  if (cents === null || cents === undefined) return "Price on request";
  const dollars = (cents / 100).toFixed(2);
  const symbol = currency === "usd" ? "$" : "";
  if (interval === "month") return `${symbol}${dollars}/month`;
  if (interval === "year") return `${symbol}${dollars}/year`;
  return `${symbol}${dollars}`;
}

function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hours, minutes] = startTime.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}

// ─── Config ──────────────────────────────────────────────────────

export async function getConfig(ownerId: string): Promise<MyaiosConfig | null> {
  const { data, error } = await supabaseAdmin
    .from("myaios_config")
    .select("*")
    .eq("owner_id", ownerId)
    .single();

  if (error || !data) {
    // Try to get the default config and clone it for this owner
    const { data: defaultConfig } = await supabaseAdmin
      .from("myaios_config")
      .select("*")
      .eq("id", "default")
      .single();

    if (defaultConfig) {
      const newConfig = { ...defaultConfig, id: genId(), owner_id: ownerId };
      delete (newConfig as Record<string, unknown>).created_at;
      delete (newConfig as Record<string, unknown>).updated_at;
      const { data: created } = await supabaseAdmin
        .from("myaios_config")
        .insert(newConfig)
        .select()
        .single();
      return created ? mapConfigRow(created as Record<string, unknown>) : null;
    }
    return null;
  }
  return mapConfigRow(data as Record<string, unknown>);
}

export async function updateConfig(ownerId: string, updates: Partial<MyaiosConfig>): Promise<MyaiosConfig | null> {
  // Convert camelCase updates to snake_case for the DB
  const snakeUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    // Special-case: myaios247 → myaios_24_7 (not myaios_2_4_7)
    if (k === "myaios247") {
      snakeUpdates["myaios_24_7"] = v;
    } else {
      snakeUpdates[k.replace(/([A-Z])/g, "_$1").toLowerCase()] = v;
    }
  }
  snakeUpdates["updated_at"] = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("myaios_config")
    .update(snakeUpdates)
    .eq("owner_id", ownerId)
    .select()
    .single();

  if (error) return null;
  return mapConfigRow(data as Record<string, unknown>);
}

// ─── Services ────────────────────────────────────────────────────

export async function listServices(ownerId: string, activeOnly = false): Promise<MyaiosService[]> {
  let query = supabaseAdmin
    .from("myaios_services")
    .select("*")
    .eq("owner_id", ownerId)
    .order("sort_order", { ascending: true });

  if (activeOnly) query = query.eq("active", true);

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r) => mapServiceRow(r as Record<string, unknown>));
}

export async function getService(ownerId: string, serviceId: string): Promise<MyaiosService | null> {
  const { data, error } = await supabaseAdmin
    .from("myaios_services")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", serviceId)
    .single();

  if (error || !data) return null;
  return mapServiceRow(data as Record<string, unknown>);
}

export async function createService(ownerId: string, service: Partial<MyaiosService>): Promise<MyaiosService | null> {
  const row = {
    owner_id: ownerId,
    name: service.name || "Untitled Service",
    description: service.description || "",
    category: service.category || "service",
    duration_minutes: service.durationMinutes ?? 30,
    price_cents: service.priceCents ?? null,
    price_interval: service.priceInterval ?? null,
    currency: service.currency || "usd",
    price_on_request: service.priceOnRequest ?? false,
    stripe_product_id: service.stripeProductId ?? null,
    stripe_price_id: service.stripePriceId ?? null,
    bookable: service.bookable ?? true,
    booking_buffer_minutes: service.bookingBufferMinutes ?? 15,
    max_bookings_per_day: service.maxBookingsPerDay ?? 10,
    available_days: service.availableDays ?? [0, 1, 2, 3, 4, 5, 6],
    available_hours_start: service.availableHoursStart ?? "09:00",
    available_hours_end: service.availableHoursEnd ?? "17:00",
    active: service.active ?? true,
    sort_order: service.sortOrder ?? 0,
    metadata: service.metadata ?? {},
  };

  const { data, error } = await supabaseAdmin
    .from("myaios_services")
    .insert(row)
    .select()
    .single();

  if (error) return null;
  return mapServiceRow(data as Record<string, unknown>);
}

export async function updateService(ownerId: string, serviceId: string, updates: Partial<MyaiosService>): Promise<MyaiosService | null> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.category !== undefined) row.category = updates.category;
  if (updates.durationMinutes !== undefined) row.duration_minutes = updates.durationMinutes;
  if (updates.priceCents !== undefined) row.price_cents = updates.priceCents;
  if (updates.priceInterval !== undefined) row.price_interval = updates.priceInterval;
  if (updates.priceOnRequest !== undefined) row.price_on_request = updates.priceOnRequest;
  if (updates.stripeProductId !== undefined) row.stripe_product_id = updates.stripeProductId;
  if (updates.stripePriceId !== undefined) row.stripe_price_id = updates.stripePriceId;
  if (updates.bookable !== undefined) row.bookable = updates.bookable;
  if (updates.active !== undefined) row.active = updates.active;
  if (updates.availableDays !== undefined) row.available_days = updates.availableDays;
  if (updates.availableHoursStart !== undefined) row.available_hours_start = updates.availableHoursStart;
  if (updates.availableHoursEnd !== undefined) row.available_hours_end = updates.availableHoursEnd;

  const { data, error } = await supabaseAdmin
    .from("myaios_services")
    .update(row)
    .eq("owner_id", ownerId)
    .eq("id", serviceId)
    .select()
    .single();

  if (error) return null;
  return mapServiceRow(data as Record<string, unknown>);
}

export async function deleteService(ownerId: string, serviceId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("myaios_services")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", serviceId);
  return !error;
}

/** Format a service for speech/text output. */
export function formatServiceForOutput(service: MyaiosService): string {
  const price = formatPrice(service.priceCents, service.priceInterval, service.currency, service.priceOnRequest);
  return `${service.name} — ${price} (${service.durationMinutes} min). ${service.description}`;
}

// ─── Bookings ────────────────────────────────────────────────────

export async function createBooking(
  ownerId: string,
  input: {
    serviceId?: string;
    serviceName: string;
    serviceDurationMinutes: number;
    servicePriceCents?: number | null;
    servicePriceInterval?: string | null;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    customerUserId?: string;
    bookingDate: string;
    bookingTime: string;
    timezone?: string;
    notes?: string;
    source?: string;
    conversationId?: string;
  },
): Promise<MyaiosBooking | null> {
  const endTime = calculateEndTime(input.bookingTime, input.serviceDurationMinutes);
  const paymentRequired = input.servicePriceCents !== null && input.servicePriceCents !== undefined && input.servicePriceCents > 0;

  const row = {
    owner_id: ownerId,
    service_id: input.serviceId ?? null,
    service_name: input.serviceName,
    service_duration_minutes: input.serviceDurationMinutes,
    service_price_cents: input.servicePriceCents ?? null,
    service_price_interval: input.servicePriceInterval ?? null,
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    customer_phone: input.customerPhone ?? null,
    customer_user_id: input.customerUserId ?? null,
    booking_date: input.bookingDate,
    booking_time: input.bookingTime,
    booking_end_time: endTime,
    timezone: input.timezone ?? "America/New_York",
    status: "confirmed",
    payment_required: paymentRequired,
    notes: input.notes ?? null,
    source: input.source ?? "voice",
    conversation_id: input.conversationId ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from("myaios_bookings")
    .insert(row)
    .select()
    .single();

  if (error) return null;

  // Log event
  await logEvent(ownerId, "myaios_booking_completed", {
    booking_id: (data as Record<string, unknown>).id,
    service_name: input.serviceName,
    source: input.source ?? "voice",
  });

  return mapBookingRow(data as Record<string, unknown>);
}

export async function getBooking(ownerId: string, bookingId: string): Promise<MyaiosBooking | null> {
  const { data, error } = await supabaseAdmin
    .from("myaios_bookings")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", bookingId)
    .single();

  if (error || !data) return null;
  return mapBookingRow(data as Record<string, unknown>);
}

export async function listBookings(ownerId: string, options?: { status?: string; date?: string; limit?: number }): Promise<MyaiosBooking[]> {
  let query = supabaseAdmin
    .from("myaios_bookings")
    .select("*")
    .eq("owner_id", ownerId)
    .order("booking_date", { ascending: true })
    .order("booking_time", { ascending: true })
    .limit(options?.limit ?? 20);

  if (options?.status) query = query.eq("status", options.status);
  if (options?.date) query = query.eq("booking_date", options.date);

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapBookingRow);
}

export async function findBookingsByCustomer(ownerId: string, email: string): Promise<MyaiosBooking[]> {
  const { data, error } = await supabaseAdmin
    .from("myaios_bookings")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("customer_email", email)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapBookingRow);
}

export async function updateBookingStatus(ownerId: string, bookingId: string, status: string, notes?: string): Promise<MyaiosBooking | null> {
  const row: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (notes !== undefined) row.notes = notes;

  const { data, error } = await supabaseAdmin
    .from("myaios_bookings")
    .update(row)
    .eq("owner_id", ownerId)
    .eq("id", bookingId)
    .select()
    .single();

  if (error) return null;

  // Log event
  const eventType = status === "cancelled" ? "myaios_booking_cancelled" :
                    status === "rescheduled" ? "myaios_booking_rescheduled" : "myaios_booking_updated";
  await logEvent(ownerId, eventType, { booking_id: bookingId, status });

  return mapBookingRow(data as Record<string, unknown>);
}

export async function rescheduleBooking(ownerId: string, bookingId: string, newDate: string, newTime: string): Promise<MyaiosBooking | null> {
  const existing = await getBooking(ownerId, bookingId);
  if (!existing) return null;

  const endTime = calculateEndTime(newTime, existing.serviceDurationMinutes);
  const { data, error } = await supabaseAdmin
    .from("myaios_bookings")
    .update({
      booking_date: newDate,
      booking_time: newTime,
      booking_end_time: endTime,
      status: "rescheduled",
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", ownerId)
    .eq("id", bookingId)
    .select()
    .single();

  if (error) return null;
  await logEvent(ownerId, "myaios_booking_rescheduled", { booking_id: bookingId, new_date: newDate, new_time: newTime });
  return mapBookingRow(data as Record<string, unknown>);
}

/** Check if a time slot is available (no conflicts). */
export async function checkSlotAvailability(ownerId: string, date: string, startTime: string, durationMinutes: number): Promise<boolean> {
  const endTime = calculateEndTime(startTime, durationMinutes);
  const { data, error } = await supabaseAdmin
    .from("myaios_bookings")
    .select("booking_time, booking_end_time")
    .eq("owner_id", ownerId)
    .eq("booking_date", date)
    .in("status", ["pending", "confirmed", "rescheduled"]);

  if (error || !data) return true; // Fail open — allow booking if we can't check

  const conflicts = (data as Array<{ booking_time: string; booking_end_time: string }>).filter((b) => {
    // Check for time overlap
    return !(endTime <= b.booking_time || startTime >= b.booking_end_time);
  });

  return conflicts.length === 0;
}

/** Generate available time slots for a date. */
export async function getAvailableSlots(
  ownerId: string,
  service: MyaiosService,
  date: string,
): Promise<string[]> {
  const dayOfWeek = new Date(date + "T00:00:00").getDay();

  // Check if service is available on this day
  if (!service.availableDays.includes(dayOfWeek)) return [];

  // Generate slots from service hours
  const [startHour, startMin] = service.availableHoursStart.split(":").map(Number);
  const [endHour, endMin] = service.availableHoursEnd.split(":").map(Number);
  const startTotal = startHour * 60 + startMin;
  const endTotal = endHour * 60 + endMin;

  const slots: string[] = [];
  for (let t = startTotal; t + service.durationMinutes <= endTotal; t += service.bookingBufferMinutes) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    const slot = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const available = await checkSlotAvailability(ownerId, date, slot, service.durationMinutes);
    if (available) slots.push(slot);
  }

  return slots;
}

// ─── Leads ───────────────────────────────────────────────────────

export async function createLead(
  ownerId: string,
  input: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    interest: string;
    serviceId?: string;
    serviceName?: string;
    projectType?: string;
    budget?: string;
    timeline?: string;
    qualificationAnswers?: Record<string, unknown>;
    source?: string;
    conversationId?: string;
    userId?: string;
    notes?: string;
  },
): Promise<MyaiosLead | null> {
  const row = {
    owner_id: ownerId,
    name: input.name ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    company: input.company ?? null,
    interest: input.interest,
    service_id: input.serviceId ?? null,
    service_name: input.serviceName ?? null,
    project_type: input.projectType ?? null,
    budget: input.budget ?? null,
    timeline: input.timeline ?? null,
    qualification_answers: input.qualificationAnswers ?? {},
    source: input.source ?? "voice",
    conversation_id: input.conversationId ?? null,
    user_id: input.userId ?? null,
    notes: input.notes ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from("myaios_leads")
    .insert(row)
    .select()
    .single();

  if (error) return null;

  await logEvent(ownerId, "myaios_lead_created", {
    lead_id: (data as Record<string, unknown>).id,
    interest: input.interest,
    source: input.source ?? "voice",
  });

  return mapLeadRow(data as Record<string, unknown>);
}

export async function updateLeadStatus(ownerId: string, leadId: string, status: string, leadScore?: number): Promise<MyaiosLead | null> {
  const row: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (leadScore !== undefined) row.lead_score = leadScore;

  const { data, error } = await supabaseAdmin
    .from("myaios_leads")
    .update(row)
    .eq("owner_id", ownerId)
    .eq("id", leadId)
    .select()
    .single();

  if (error) return null;
  return mapLeadRow(data as Record<string, unknown>);
}

export async function findLeadByEmail(ownerId: string, email: string): Promise<MyaiosLead | null> {
  const { data, error } = await supabaseAdmin
    .from("myaios_leads")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return mapLeadRow(data as Record<string, unknown>);
}

export async function listLeads(ownerId: string, options?: { status?: string; limit?: number }): Promise<MyaiosLead[]> {
  let query = supabaseAdmin
    .from("myaios_leads")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 20);

  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapLeadRow);
}

// ─── Escalations ─────────────────────────────────────────────────

export async function createEscalation(
  ownerId: string,
  input: {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    customerUserId?: string;
    reason: string;
    urgency?: string;
    intent?: string;
    relevantService?: string;
    conversationSummary: string;
    conversationId?: string;
    requestedAction: string;
    leadId?: string;
    source?: string;
  },
): Promise<MyaiosEscalation | null> {
  const row = {
    owner_id: ownerId,
    customer_name: input.customerName ?? null,
    customer_email: input.customerEmail ?? null,
    customer_phone: input.customerPhone ?? null,
    customer_user_id: input.customerUserId ?? null,
    reason: input.reason,
    urgency: input.urgency ?? "normal",
    intent: input.intent ?? null,
    relevant_service: input.relevantService ?? null,
    conversation_summary: input.conversationSummary,
    conversation_id: input.conversationId ?? null,
    requested_action: input.requestedAction,
    lead_id: input.leadId ?? null,
    source: input.source ?? "voice",
  };

  const { data, error } = await supabaseAdmin
    .from("myaios_escalations")
    .insert(row)
    .select()
    .single();

  if (error) return null;

  await logEvent(ownerId, "myaios_escalated", {
    escalation_id: (data as Record<string, unknown>).id,
    reason: input.reason,
    urgency: input.urgency ?? "normal",
  });

  return mapEscalationRow(data as Record<string, unknown>);
}

export async function listEscalations(ownerId: string, options?: { status?: string; limit?: number }): Promise<MyaiosEscalation[]> {
  let query = supabaseAdmin
    .from("myaios_escalations")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 20);

  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapEscalationRow);
}

// ─── Staff Hours ─────────────────────────────────────────────────

export async function getStaffHours(ownerId: string): Promise<StaffHours[]> {
  const { data, error } = await supabaseAdmin
    .from("myaios_staff_hours")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("active", true);

  if (error || !data) return [];
  return data as unknown as StaffHours[];
}

export async function updateStaffHours(ownerId: string, staffId: string, schedule: Record<string, unknown>): Promise<StaffHours | null> {
  const { data, error } = await supabaseAdmin
    .from("myaios_staff_hours")
    .update({ schedule, updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("id", staffId)
    .select()
    .single();

  if (error) return null;
  return data as unknown as StaffHours;
}

/** Check if staff are currently available (not just myaios). */
export async function isStaffAvailable(ownerId: string, date?: string): Promise<boolean> {
  const staff = await getStaffHours(ownerId);
  if (staff.length === 0) return false; // No staff configured = not available

  const checkDate = date ? new Date(date + "T00:00:00") : new Date();
  const dayOfWeek = checkDate.getDay().toString();

  return staff.some((s) => {
    const daySchedule = s.schedule[dayOfWeek];
    return daySchedule?.available === true;
  });
}

// ─── Events ──────────────────────────────────────────────────────

export async function logEvent(
  ownerId: string,
  eventType: string,
  metadata?: Record<string, unknown>,
  conversationId?: string,
): Promise<void> {
  try {
    await supabaseAdmin.from("myaios_events").insert({
      owner_id: ownerId,
      event_type: eventType,
      metadata: metadata ?? {},
      conversation_id: conversationId ?? null,
      source: "api",
    });
  } catch {
    // Non-fatal — analytics should never break the main flow
  }
}

// ─── Dashboard Summary ───────────────────────────────────────────

export async function getDashboardSummary(ownerId: string): Promise<{
  activeBookings: number;
  upcomingBookings: MyaiosBooking[];
  newLeads: number;
  openEscalations: number;
  activeServices: number;
  staffAvailable: boolean;
}> {
  const today = new Date().toISOString().split("T")[0];

  const [bookings, leads, escalations, services, staffAvail] = await Promise.all([
    listBookings(ownerId, { status: "confirmed", limit: 5 }),
    listLeads(ownerId, { status: "new", limit: 100 }),
    listEscalations(ownerId, { status: "open", limit: 100 }),
    listServices(ownerId, true),
    isStaffAvailable(ownerId),
  ]);

  const upcoming = bookings.filter((b) => b.bookingDate >= today).slice(0, 5);

  return {
    activeBookings: bookings.length,
    upcomingBookings: upcoming,
    newLeads: leads.length,
    openEscalations: escalations.length,
    activeServices: services.length,
    staffAvailable: staffAvail,
  };
}

// ─── Utils ───────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
