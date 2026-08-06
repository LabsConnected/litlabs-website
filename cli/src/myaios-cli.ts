#!/usr/bin/env node

import process from "node:process";
import { Command } from "commander";

const program = new Command();

program
  .name("myaios")
  .description("MyAios Brain CLI — manage services, bookings, leads, and config from the terminal")
  .version("0.1.0")
  .option("-u, --url <url>", "MyAios API base URL", process.env.MYAIOS_URL || "https://litlabs.net")
  .option("-k, --key <key>", "Internal API key", process.env.INTERNAL_API_KEY || "")
  .option("-o, --owner <id>", "Owner ID (required for most operations)", process.env.MYAIOS_OWNER_ID || "")
  .hook("preAction", (cmd) => {
    if (!cmd.opts().key) {
      console.error("Error: API key required. Set INTERNAL_API_KEY env var or use --key.");
      process.exit(1);
    }
  });

// ─── Config ──────────────────────────────────────────────────

program
  .command("get-config")
  .description("Get MyAios configuration")
  .action(async () => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "get_config", {});
    console.log(res);
  });

program
  .command("update-config")
  .description("Update MyAios configuration")
  .option("--business-name <name>")
  .option("--business-description <desc>")
  .option("--website <url>")
  .option("--contact-email <email>")
  .option("--contact-phone <phone>")
  .option("--timezone <tz>")
  .option("--greeting <text>")
  .option("--instructions <text>")
  .option("--247 <bool>", "Enable 24/7 mode (true/false)")
  .option("--cancellation-policy <text>")
  .option("--confirmation-message <text>")
  .option("--booking-page-intro <text>")
  .action(async (opts) => {
    const { key, owner, url } = program.opts();
    const params: Record<string, unknown> = {};
    if (opts.businessName) params.business_name = opts.businessName;
    if (opts.businessDescription) params.business_description = opts.businessDescription;
    if (opts.website) params.website = opts.website;
    if (opts.contactEmail) params.contact_email = opts.contactEmail;
    if (opts.contactPhone) params.contact_phone = opts.contactPhone;
    if (opts.timezone) params.timezone = opts.timezone;
    if (opts.greeting) params.greeting = opts.greeting;
    if (opts.instructions) params.instructions = opts.instructions;
    if (opts["247"]) params.myaios_24_7 = opts["247"] === "true";
    if (opts.cancellationPolicy) params.cancellation_policy = opts.cancellationPolicy;
    if (opts.confirmationMessage) params.confirmation_message = opts.confirmationMessage;
    if (opts.bookingPageIntro) params.booking_page_intro = opts.bookingPageIntro;
    const res = await callApi(url, key, owner, "update_config", params);
    console.log(res);
  });

// ─── Services ────────────────────────────────────────────────

program
  .command("list-services")
  .description("List all active services")
  .action(async () => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "list_services", {});
    console.log(res);
  });

program
  .command("get-service <service-id>")
  .description("Get a single service by ID")
  .action(async (serviceId: string) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "get_service", { service_id: serviceId });
    console.log(res);
  });

program
  .command("create-service")
  .description("Create a new service")
  .requiredOption("--name <name>")
  .requiredOption("--duration <minutes>")
  .requiredOption("--price <amount>")
  .option("--description <desc>")
  .option("--category <cat>")
  .option("--stripe-price-id <id>")
  .action(async (opts) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "create_service", {
      name: opts.name,
      duration_minutes: parseInt(opts.duration, 10),
      price: parseFloat(opts.price),
      description: opts.description || "",
      category: opts.category || "general",
      stripe_price_id: opts.stripePriceId || null,
    });
    console.log(res);
  });

program
  .command("delete-service <service-id>")
  .description("Delete a service")
  .action(async (serviceId: string) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "delete_service", { service_id: serviceId });
    console.log(res);
  });

// ─── Bookings ────────────────────────────────────────────────

program
  .command("get-slots <service-id> <date>")
  .description("Get available booking slots (date: YYYY-MM-DD)")
  .action(async (serviceId: string, date: string) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "get_available_slots", {
      service_id: serviceId,
      date,
    });
    console.log(res);
  });

program
  .command("create-booking")
  .description("Create a booking")
  .requiredOption("--service-id <id>")
  .requiredOption("--date <YYYY-MM-DD>")
  .requiredOption("--time <HH:MM>")
  .requiredOption("--customer-name <name>")
  .requiredOption("--customer-email <email>")
  .option("--customer-phone <phone>")
  .action(async (opts) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "create_booking", {
      service_id: opts.serviceId,
      date: opts.date,
      time: opts.time,
      customer_name: opts.customerName,
      customer_email: opts.customerEmail,
      customer_phone: opts.customerPhone || null,
    });
    console.log(res);
  });

program
  .command("get-booking <booking-id>")
  .description("Get a booking by ID")
  .action(async (bookingId: string) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "get_booking", { booking_id: bookingId });
    console.log(res);
  });

program
  .command("find-bookings <email>")
  .description("Find bookings by customer email")
  .action(async (email: string) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "find_bookings", { customer_email: email });
    console.log(res);
  });

program
  .command("reschedule-booking <booking-id> <date> <time>")
  .description("Reschedule a booking (date: YYYY-MM-DD, time: HH:MM)")
  .action(async (bookingId: string, date: string, time: string) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "reschedule_booking", {
      booking_id: bookingId,
      new_date: date,
      new_time: time,
    });
    console.log(res);
  });

program
  .command("cancel-booking <booking-id>")
  .description("Cancel a booking")
  .option("--reason <text>")
  .action(async (bookingId: string, opts) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "cancel_booking", {
      booking_id: bookingId,
      reason: opts.reason || "",
    });
    console.log(res);
  });

// ─── Leads ───────────────────────────────────────────────────

program
  .command("create-lead")
  .description("Capture a lead")
  .requiredOption("--name <name>")
  .requiredOption("--email <email>")
  .option("--phone <phone>")
  .option("--company <company>")
  .option("--budget <budget>")
  .option("--timeline <timeline>")
  .option("--project-type <type>")
  .option("--notes <notes>")
  .action(async (opts) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "create_lead", {
      name: opts.name,
      email: opts.email,
      phone: opts.phone || null,
      company: opts.company || null,
      budget: opts.budget || null,
      timeline: opts.timeline || null,
      project_type: opts.projectType || null,
      notes: opts.notes || null,
    });
    console.log(res);
  });

program
  .command("update-lead <lead-id> <status>")
  .description("Update lead status (e.g. qualified, contacted, converted, lost)")
  .action(async (leadId: string, status: string) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "update_lead_status", {
      lead_id: leadId,
      status,
    });
    console.log(res);
  });

// ─── Escalations ─────────────────────────────────────────────

program
  .command("escalate")
  .description("Create a human escalation")
  .requiredOption("--reason <reason>")
  .option("--booking-id <id>")
  .option("--lead-id <id>")
  .option("--priority <level>", "Priority: low, medium, high, urgent", "medium")
  .action(async (opts) => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "create_escalation", {
      reason: opts.reason,
      booking_id: opts.bookingId || null,
      lead_id: opts.leadId || null,
      priority: opts.priority,
    });
    console.log(res);
  });

// ─── Dashboard & Staff Hours ─────────────────────────────────

program
  .command("dashboard")
  .description("Get dashboard summary")
  .action(async () => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "get_dashboard", {});
    console.log(res);
  });

program
  .command("staff-hours")
  .description("Get staff availability hours")
  .action(async () => {
    const { key, owner, url } = program.opts();
    const res = await callApi(url, key, owner, "get_staff_hours", {});
    console.log(res);
  });

program
  .command("update-staff-hours")
  .description("Update staff hours (JSON string)")
  .requiredOption("--hours <json>")
  .action(async (opts) => {
    const { key, owner, url } = program.opts();
    let hours: unknown;
    try {
      hours = JSON.parse(opts.hours);
    } catch {
      console.error("Error: --hours must be valid JSON");
      process.exit(1);
    }
    const res = await callApi(url, key, owner, "update_staff_hours", { hours });
    console.log(res);
  });

// ─── API helper ──────────────────────────────────────────────

async function callApi(
  baseUrl: string,
  apiKey: string,
  ownerId: string,
  operation: string,
  parameters: Record<string, unknown>,
): Promise<string> {
  if (!ownerId) {
    return "Error: Owner ID required. Set MYAIOS_OWNER_ID env var or use --owner.";
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/internal/elevenlabs/myaios`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": apiKey,
      },
      body: JSON.stringify({
        operation,
        owner_id: ownerId,
        parameters,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return `Error: HTTP ${res.status} — ${text || res.statusText}`;
    }

    const data = await res.json() as { result?: string };
    return data.result || "Operation completed but returned no result.";
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

program.parse();
