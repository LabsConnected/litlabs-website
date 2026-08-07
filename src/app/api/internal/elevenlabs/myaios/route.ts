/**
 * Internal API: Myaios Brain (Unified)
 *
 * ONE endpoint for all Myaios operations. Called by:
 *   - ElevenLabs voice tools (during phone calls)
 *   - LiTT chat (admin commands like "set hours to 9-5")
 *   - Web booking page (public bookings)
 *
 * Auth: x-internal-api-key OR Authorization: Bearer (matches INTERNAL_API_KEY)
 *
 * Operations:
 *   get_config          — get myaios configuration
 *   update_config       — update myaios config (admin)
 *   list_services       — list all services
 *   get_service         — get a single service
 *   create_service      — create a service (admin)
 *   update_service      — update a service (admin)
 *   delete_service      — delete a service (admin)
 *   get_available_slots — get available booking slots for a service + date
 *   create_booking      — create a booking
 *   get_booking         — get a booking by ID
 *   find_bookings       — find bookings by customer email
 *   reschedule_booking  — reschedule a booking
 *   cancel_booking      — cancel a booking
 *   create_lead         — capture a lead
 *   update_lead_status  — update lead status
 *   create_escalation   — escalate to human
 *   get_dashboard       — get dashboard summary
 *   get_staff_hours     — get staff availability
 *   update_staff_hours  — update staff hours (admin)
 *   get_project_knowledge — get verified project knowledge (architecture, deps, etc.)
 *   search_project_knowledge — search project knowledge by keyword
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import * as Brain from "@/lib/myaios/myaios-brain";

export const runtime = "nodejs";
export const maxDuration = 60;

function safeSecretEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false;

  const internalKey = req.headers.get("x-internal-api-key");
  if (internalKey && safeSecretEqual(internalKey, expected)) return true;

  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (safeSecretEqual(token, expected)) return true;
  }

  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const operation = (body.operation as string) || "";
  const ownerId = (body.owner_id as string) || (body.ownerId as string) || "";
  const params = (body.parameters as Record<string, unknown>) || body;

  if (!ownerId) {
    return NextResponse.json({ error: "Missing owner_id" }, { status: 400 });
  }

  try {
    const result = await handleOperation(operation, ownerId, params);
    return NextResponse.json({ result });
  } catch (err) {
    console.error(`[myaios] Error in ${operation}:`, err);
    return NextResponse.json({
      result: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

async function handleOperation(
  operation: string,
  ownerId: string,
  p: Record<string, unknown>,
): Promise<string> {
  switch (operation) {
    // ─── Config ──────────────────────────────────────────────
    case "get_config": {
      const config = await Brain.getConfig(ownerId);
      if (!config) return "No myaios configuration found.";
      return JSON.stringify({
        businessName: config.businessName,
        receptionistName: config.receptionistName,
        greeting: config.greeting,
        myaios247: config.myaios247,
        timezone: config.timezone,
        cancellationPolicy: config.cancellationPolicy,
        bookingPageSlug: config.bookingPageSlug,
      });
    }

    case "update_config": {
      const updates: Partial<Brain.MyaiosConfig> = {};
      if (typeof p.business_name === "string") updates.businessName = p.business_name;
      if (typeof p.business_description === "string") updates.businessDescription = p.business_description;
      if (typeof p.website === "string") updates.website = p.website;
      if (typeof p.contact_email === "string") updates.contactEmail = p.contact_email;
      if (typeof p.contact_phone === "string") updates.contactPhone = p.contact_phone;
      if (typeof p.timezone === "string") updates.timezone = p.timezone;
      if (typeof p.greeting === "string") updates.greeting = p.greeting;
      if (typeof p.instructions === "string") updates.instructions = p.instructions;
      if (typeof p.myaios_24_7 === "boolean") updates.myaios247 = p.myaios_24_7;
      if (typeof p.cancellation_policy === "string") updates.cancellationPolicy = p.cancellation_policy;
      if (typeof p.confirmation_message === "string") updates.confirmationMessage = p.confirmation_message;
      if (typeof p.booking_page_intro === "string") updates.bookingPageIntro = p.booking_page_intro;

      const config = await Brain.updateConfig(ownerId, updates);
      if (!config) return "Failed to update configuration.";
      return `Configuration updated. Business: ${config.businessName}, Myaios 24/7: ${config.myaios247}.`;
    }

    // ─── Services ────────────────────────────────────────────
    case "list_services": {
      const services = await Brain.listServices(ownerId, true);
      if (services.length === 0) return "No active services configured.";
      return services.map((s) => Brain.formatServiceForOutput(s)).join("\n");
    }

    case "get_service": {
      const serviceId = (p.service_id as string) || "";
      if (!serviceId) return "Missing service_id.";
      const service = await Brain.getService(ownerId, serviceId);
      if (!service) return "Service not found.";
      return Brain.formatServiceForOutput(service);
    }

    case "create_service": {
      const service = await Brain.createService(ownerId, {
        name: p.name as string,
        description: p.description as string,
        category: p.category as string,
        durationMinutes: p.duration_minutes as number,
        priceCents: p.price_cents as number,
        priceInterval: p.price_interval as string,
        priceOnRequest: p.price_on_request as boolean,
        stripeProductId: p.stripe_product_id as string,
        stripePriceId: p.stripe_price_id as string,
        availableDays: p.available_days as number[],
        availableHoursStart: p.available_hours_start as string,
        availableHoursEnd: p.available_hours_end as string,
      });
      if (!service) return "Failed to create service.";
      return `Service created: ${service.name} — ${Brain.formatServiceForOutput(service)}`;
    }

    case "update_service": {
      const serviceId = (p.service_id as string) || "";
      if (!serviceId) return "Missing service_id.";
      const updates: Partial<Brain.MyaiosService> = {};
      if (typeof p.name === "string") updates.name = p.name;
      if (typeof p.description === "string") updates.description = p.description;
      if (typeof p.price_cents === "number") updates.priceCents = p.price_cents;
      if (typeof p.price_interval === "string") updates.priceInterval = p.price_interval;
      if (typeof p.price_on_request === "boolean") updates.priceOnRequest = p.price_on_request;
      if (typeof p.duration_minutes === "number") updates.durationMinutes = p.duration_minutes;
      if (typeof p.active === "boolean") updates.active = p.active;
      if (Array.isArray(p.available_days)) updates.availableDays = p.available_days;
      if (typeof p.available_hours_start === "string") updates.availableHoursStart = p.available_hours_start;
      if (typeof p.available_hours_end === "string") updates.availableHoursEnd = p.available_hours_end;
      if (typeof p.stripe_product_id === "string") updates.stripeProductId = p.stripe_product_id;
      if (typeof p.stripe_price_id === "string") updates.stripePriceId = p.stripe_price_id;

      const service = await Brain.updateService(ownerId, serviceId, updates);
      if (!service) return "Failed to update service.";
      return `Service updated: ${service.name}.`;
    }

    case "delete_service": {
      const serviceId = (p.service_id as string) || "";
      if (!serviceId) return "Missing service_id.";
      const ok = await Brain.deleteService(ownerId, serviceId);
      return ok ? "Service deleted." : "Failed to delete service.";
    }

    // ─── Bookings ────────────────────────────────────────────
    case "get_available_slots": {
      const serviceId = (p.service_id as string) || "";
      const date = (p.date as string) || "";
      if (!serviceId || !date) return "Missing service_id or date.";

      const service = await Brain.getService(ownerId, serviceId);
      if (!service) return "Service not found.";

      const slots = await Brain.getAvailableSlots(ownerId, service, date);
      if (slots.length === 0) return `No available slots for ${date}.`;
      return `Available slots for ${date}: ${slots.join(", ")}`;
    }

    case "create_booking": {
      const serviceId = (p.service_id as string) || "";
      const serviceName = (p.service_name as string) || "";
      const customerName = (p.customer_name as string) || "";
      const customerEmail = (p.customer_email as string) || "";
      const bookingDate = (p.booking_date as string) || "";
      const bookingTime = (p.booking_time as string) || "";

      if (!serviceName || !customerName || !customerEmail || !bookingDate || !bookingTime) {
        return "Missing required fields: service_name, customer_name, customer_email, booking_date, booking_time";
      }

      // Get service details if we have a service_id
      let duration = (p.duration_minutes as number) || 30;
      let priceCents = p.price_cents as number | null ?? null;
      let priceInterval = (p.price_interval as string) || null;

      if (serviceId) {
        const service = await Brain.getService(ownerId, serviceId);
        if (service) {
          duration = service.durationMinutes;
          priceCents = service.priceCents;
          priceInterval = service.priceInterval;
        }
      }

      // Check availability
      const available = await Brain.checkSlotAvailability(ownerId, bookingDate, bookingTime, duration);
      if (!available) return `That time slot (${bookingTime} on ${bookingDate}) is already booked. Would you like me to check other times?`;

      const booking = await Brain.createBooking(ownerId, {
        serviceId: serviceId || undefined,
        serviceName,
        serviceDurationMinutes: duration,
        servicePriceCents: priceCents,
        servicePriceInterval: priceInterval,
        customerName,
        customerEmail,
        customerPhone: p.customer_phone as string,
        customerUserId: p.customer_user_id as string,
        bookingDate,
        bookingTime,
        timezone: p.timezone as string,
        notes: p.notes as string,
        source: p.source as string,
        conversationId: p.conversation_id as string,
      });

      if (!booking) return "Failed to create booking.";
      return `Booking confirmed for ${customerName}: ${serviceName} on ${bookingDate} at ${bookingTime}. A confirmation will be sent to ${customerEmail}.`;
    }

    case "get_booking": {
      const bookingId = (p.booking_id as string) || "";
      if (!bookingId) return "Missing booking_id.";
      const booking = await Brain.getBooking(ownerId, bookingId);
      if (!booking) return "Booking not found.";
      return `Booking: ${booking.serviceName} for ${booking.customerName} on ${booking.bookingDate} at ${booking.bookingTime}. Status: ${booking.status}.`;
    }

    case "find_bookings": {
      const email = (p.email as string) || "";
      if (!email) return "Missing email.";
      const bookings = await Brain.findBookingsByCustomer(ownerId, email);
      if (bookings.length === 0) return `No bookings found for ${email}.`;
      return bookings.map((b) =>
        `${b.serviceName} on ${b.bookingDate} at ${b.bookingTime} — ${b.status}`
      ).join(". ");
    }

    case "reschedule_booking": {
      const bookingId = (p.booking_id as string) || "";
      const newDate = (p.new_date as string) || "";
      const newTime = (p.new_time as string) || "";
      if (!bookingId || !newDate || !newTime) return "Missing booking_id, new_date, or new_time.";

      const booking = await Brain.rescheduleBooking(ownerId, bookingId, newDate, newTime);
      if (!booking) return "Failed to reschedule booking.";
      return `Booking rescheduled to ${newDate} at ${newTime} for ${booking.customerName}.`;
    }

    case "cancel_booking": {
      const bookingId = (p.booking_id as string) || "";
      if (!bookingId) return "Missing booking_id.";
      const booking = await Brain.updateBookingStatus(ownerId, bookingId, "cancelled");
      if (!booking) return "Failed to cancel booking.";
      return `Booking cancelled for ${booking.customerName}.`;
    }

    // ─── Leads ───────────────────────────────────────────────
    case "create_lead": {
      const interest = (p.interest as string) || "";
      if (!interest) return "Missing interest.";

      const lead = await Brain.createLead(ownerId, {
        name: p.name as string,
        email: p.email as string,
        phone: p.phone as string,
        company: p.company as string,
        interest,
        serviceId: p.service_id as string,
        serviceName: p.service_name as string,
        projectType: p.project_type as string,
        budget: p.budget as string,
        timeline: p.timeline as string,
        qualificationAnswers: p.qualification_answers as Record<string, unknown>,
        source: p.source as string,
        conversationId: p.conversation_id as string,
        userId: p.user_id as string,
        notes: p.notes as string,
      });

      if (!lead) return "Failed to capture lead.";
      return `Lead captured: ${lead.name || "Anonymous"} — interest: ${interest}. Lead ID: ${lead.id}.`;
    }

    case "update_lead_status": {
      const leadId = (p.lead_id as string) || "";
      const status = (p.status as string) || "";
      if (!leadId || !status) return "Missing lead_id or status.";

      const lead = await Brain.updateLeadStatus(ownerId, leadId, status, p.lead_score as number);
      if (!lead) return "Failed to update lead.";
      return `Lead ${leadId} updated to status: ${status}.`;
    }

    // ─── Escalations ─────────────────────────────────────────
    case "create_escalation": {
      const reason = (p.reason as string) || "";
      const conversationSummary = (p.conversation_summary as string) || "";
      const requestedAction = (p.requested_action as string) || "";
      if (!reason || !conversationSummary || !requestedAction) {
        return "Missing reason, conversation_summary, or requested_action.";
      }

      const escalation = await Brain.createEscalation(ownerId, {
        customerName: p.customer_name as string,
        customerEmail: p.customer_email as string,
        customerPhone: p.customer_phone as string,
        customerUserId: p.customer_user_id as string,
        reason,
        urgency: p.urgency as string,
        intent: p.intent as string,
        relevantService: p.relevant_service as string,
        conversationSummary,
        conversationId: p.conversation_id as string,
        requestedAction,
        leadId: p.lead_id as string,
        source: p.source as string,
      });

      if (!escalation) return "Failed to create escalation.";
      return `Escalation created (ID: ${escalation.id}). Reason: ${reason}. Urgency: ${escalation.urgency}. The team will follow up with ${escalation.customerName || "the customer"}.`;
    }

    // ─── Dashboard ───────────────────────────────────────────
    case "get_dashboard": {
      const summary = await Brain.getDashboardSummary(ownerId);
      return JSON.stringify({
        activeBookings: summary.activeBookings,
        newLeads: summary.newLeads,
        openEscalations: summary.openEscalations,
        activeServices: summary.activeServices,
        staffAvailable: summary.staffAvailable,
        upcomingBookings: summary.upcomingBookings.map((b) => ({
          service: b.serviceName,
          customer: b.customerName,
          date: b.bookingDate,
          time: b.bookingTime,
        })),
      });
    }

    // ─── Staff Hours ─────────────────────────────────────────
    case "get_staff_hours": {
      const staff = await Brain.getStaffHours(ownerId);
      if (staff.length === 0) return "No staff hours configured.";
      return staff.map((s) => {
        const days = Object.entries(s.schedule)
          .filter(([, v]) => v.available)
          .map(([day, v]) => `Day ${day}: ${v.start}-${v.end}`)
          .join(", ");
        return `${s.staffName} (${s.staffRole}): ${days}`;
      }).join("\n");
    }

    case "update_staff_hours": {
      const staffId = (p.staff_id as string) || "";
      const schedule = p.schedule as Record<string, unknown>;
      if (!staffId || !schedule) return "Missing staff_id or schedule.";
      const result = await Brain.updateStaffHours(ownerId, staffId, schedule);
      if (!result) return "Failed to update staff hours.";
      return `Staff hours updated for ${result.staffName}.`;
    }

    // ─── Project Knowledge ───────────────────────────────────
    case "get_project_knowledge": {
      const projectId = (p.project_id as string) || "";
      if (!projectId) return "Missing project_id.";
      const category = p.category as string | undefined;
      const { KnowledgeService } = await import("@/lib/litt-intelligence/knowledge-service");
      const ks = new KnowledgeService();
      const records = await ks.search(ownerId, projectId, {
        category: category as never,
        verificationStatus: "verified",
        limit: 20,
      });
      if (records.length === 0) return "No project knowledge found. Ask the owner to scan the project first.";
      return records.map((r) =>
        `[${r.category}] ${r.content}${r.sourceReference ? ` (source: ${r.sourceReference})` : ""}`,
      ).join("\n");
    }

    case "search_project_knowledge": {
      const projectId = (p.project_id as string) || "";
      const query = (p.query as string) || "";
      if (!projectId || !query) return "Missing project_id or query.";
      const { KnowledgeService } = await import("@/lib/litt-intelligence/knowledge-service");
      const ks = new KnowledgeService();
      const records = await ks.search(ownerId, projectId, { limit: 30 });
      if (records.length === 0) return "No project knowledge found.";
      const lower = query.toLowerCase();
      const matches = records.filter((r) =>
        r.content.toLowerCase().includes(lower) ||
        r.category.toLowerCase().includes(lower),
      );
      if (matches.length === 0) return `No knowledge matching "${query}".`;
      return matches.map((r) =>
        `[${r.category}] ${r.content}${r.sourceReference ? ` (source: ${r.sourceReference})` : ""}`,
      ).join("\n");
    }

    default:
      return `Unknown operation: ${operation}. Available: get_config, update_config, list_services, get_service, create_service, update_service, delete_service, get_available_slots, create_booking, get_booking, find_bookings, reschedule_booking, cancel_booking, create_lead, update_lead_status, create_escalation, get_dashboard, get_staff_hours, update_staff_hours, get_project_knowledge, search_project_knowledge`;
  }
}
