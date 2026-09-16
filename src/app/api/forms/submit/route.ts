/**
 * Platform form backend — POST /api/forms/submit
 *
 * Accepts contact/lead form submissions from ANY published site.
 * The canvas static export renders `<form action="/api/forms/submit">`
 * with a hidden `deploymentId`; a tiny inline script POSTs JSON (fetch)
 * so the visitor never leaves the page, and plain form POST (urlencoded)
 * works as a no-JS fallback.
 *
 * The deployment id resolves to the site owner via the deployment store
 * (only `ready` deployments accept submissions). The lead is stored in
 * `business_leads` with a server-set source, and the owner is notified
 * by email when they configured `notification_email` on their business
 * config — zero config required from the site visitor, no third-party
 * signup for the site owner.
 *
 * Security:
 *   - Zod validates every field (type, length, format, field count)
 *   - deploymentId must resolve to a ready deployment — the client can
 *     never name an arbitrary owner
 *   - Server sets status="new" and source — the client cannot override
 *   - Honeypot field silently drops bot submissions
 *   - Per-IP rate limiting via withRateLimit
 *   - CORS is answered openly (published pages are sandboxed, opaque
 *     origin) — no credentials accepted
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRateLimit } from "@/lib/rate-limiter";
import { getBusinessConfig, createLead } from "@/lib/business-operations";
import {
  resolveSiteOwner,
  withCors,
  corsPreflight,
  DEPLOYMENT_ID_PATTERN,
} from "@/lib/business-public";

export const runtime = "nodejs";

// ─── Zod schema ─────────────────────────────────────────────────────

const fieldsSchema = z
  .record(
    z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_. -]+$/, "Invalid field name"),
    z.string().max(5000),
  )
  .refine((obj) => Object.keys(obj).length >= 1 && Object.keys(obj).length <= 25, {
    message: "Between 1 and 25 fields are required",
  });

const formSubmitSchema = z.object({
  deploymentId: z.string().regex(DEPLOYMENT_ID_PATTERN, "Invalid deployment id"),
  formName: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  page: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
  fields: fieldsSchema,
  // Honeypot — must stay empty; bots fill it.
  website: z.string().max(500).optional().nullable(),
});

type FormSubmit = z.infer<typeof formSubmitSchema>;

// ─── Body parsing (JSON primary, urlencoded no-JS fallback) ─────────

const RESERVED_BODY_KEYS = new Set(["deploymentId", "formName", "page", "website"]);

async function parseBody(req: NextRequest): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    const fields: Record<string, string> = {};
    const rest: Record<string, string> = {};
    for (const [key, value] of params) {
      if (RESERVED_BODY_KEYS.has(key)) rest[key] = value;
      else fields[key] = value;
    }
    return { ...rest, fields };
  }
  return req.json();
}

// ─── Owner email notification (best-effort, throttled) ──────────────

const NOTIFY_WINDOW_MS = 10 * 60_000;
const NOTIFY_MAX_PER_WINDOW = 5;
const notifyTimestamps = new Map<string, number[]>();

function notifyAllowed(deploymentId: string): boolean {
  const now = Date.now();
  const stamps = (notifyTimestamps.get(deploymentId) ?? []).filter((t) => now - t < NOTIFY_WINDOW_MS);
  if (stamps.length >= NOTIFY_MAX_PER_WINDOW) {
    notifyTimestamps.set(deploymentId, stamps);
    return false;
  }
  stamps.push(now);
  notifyTimestamps.set(deploymentId, stamps);
  return true;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Fire-and-forget: email the site owner about a new lead.
 * Only sends when the owner configured `notification_email` on their
 * business config and the platform has a Resend key. Never throws,
 * never blocks the response.
 */
function notifyOwner(
  ownerId: string,
  deploymentId: string,
  data: FormSubmit,
  name: string,
): void {
  void (async () => {
    try {
      if (!notifyAllowed(deploymentId)) return;
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) return;
      const config = await getBusinessConfig(ownerId);
      const to = config.ok && config.data ? config.data.notification_email : null;
      if (!to) return;

      const rows = Object.entries(data.fields)
        .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
        .join("");
      const subject = `New lead from your site${data.formName ? ` — ${data.formName}` : ""}`;
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: "LiTT <notifications@litlabs.net>",
          to,
          subject,
          html: `<h2>${escapeHtml(subject)}</h2>
            <p><strong>${escapeHtml(name)}</strong> just submitted${data.formName ? ` the “${escapeHtml(data.formName)}” form` : " a form"} on your published site.</p>
            <table>${rows}</table>
            ${data.page ? `<p style="color:#888;font-size:12px">Page: ${escapeHtml(data.page)}</p>` : ""}
            <hr /><p style="color:#888;font-size:12px">Sent by LiTT — view all leads in Studio.</p>`,
        }),
      });
      if (!resp.ok) console.error("forms/submit: lead notification email failed", resp.status);
    } catch (err) {
      console.error("forms/submit: lead notification error", err);
    }
  })();
}

// ─── Lead mapping ───────────────────────────────────────────────────

const NAME_KEYS = ["name", "full_name", "fullname", "your_name", "contact_name"];
const EMAIL_KEYS = ["email", "email_address", "e-mail", "your_email"];
const PHONE_KEYS = ["phone", "phone_number", "telephone", "mobile", "your_phone"];

function pickField(fields: Record<string, string>, keys: string[]): string | null {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) lower[k.toLowerCase().replace(/[\s_-]+/g, "_")] = v;
  for (const key of keys) {
    const v = lower[key]?.trim();
    if (v) return v;
  }
  return null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Handlers ───────────────────────────────────────────────────────

function json(data: unknown, status = 200): NextResponse {
  const res = NextResponse.json(data, { status });
  withCors(res.headers);
  return res;
}

async function postHandler(req: NextRequest): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await parseBody(req);
  } catch {
    return json({ ok: false, error: "Invalid request body" }, 400);
  }

  const parsed = formSubmitSchema.safeParse(raw);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return json({ ok: false, error: firstError?.message ?? "Validation failed" }, 400);
  }
  const data = parsed.data;

  // Honeypot — pretend success, store nothing.
  if (data.website && data.website.trim().length > 0) {
    return json({ ok: true });
  }

  const resolution = await resolveSiteOwner(data.deploymentId);
  if (!resolution.ok) {
    return json({ ok: false, error: resolution.error }, resolution.status);
  }

  const email = pickField(data.fields, EMAIL_KEYS);
  const name = pickField(data.fields, NAME_KEYS) ?? email ?? "Website visitor";
  const phone = pickField(data.fields, PHONE_KEYS);

  const usedKeys = new Set<string>();
  for (const [k] of Object.entries(data.fields)) {
    const norm = k.toLowerCase().replace(/[\s_-]+/g, "_");
    if ([...NAME_KEYS, ...EMAIL_KEYS, ...PHONE_KEYS].includes(norm)) usedKeys.add(k);
  }
  const extra = Object.entries(data.fields)
    .filter(([k]) => !usedKeys.has(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const result = await createLead(resolution.ownerId, {
    name: name.slice(0, 200),
    email: email && EMAIL_PATTERN.test(email) ? email.slice(0, 320) : null,
    phone: phone?.slice(0, 30) ?? null,
    // Server-set — the client cannot choose or spoof the source.
    source: "site_form",
    notes: extra ? extra.slice(0, 5000) : null,
    metadata: {
      deploymentId: resolution.deploymentId,
      formName: data.formName,
      page: data.page,
      fields: data.fields,
    },
  });

  if (!result.ok) {
    console.error("forms/submit: lead insert failed", result.error);
    return json({ ok: false, error: "Service temporarily unavailable" }, 503);
  }

  notifyOwner(resolution.ownerId, resolution.deploymentId, data, name);

  return json({ ok: true, leadId: result.data?.id });
}

const rateLimitedPost = withRateLimit(postHandler, 20, 60);

export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  const res = await rateLimitedPost(req);
  withCors(res.headers);
  return res;
}

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET() {
  return json({ ok: false, error: "Method not allowed" }, 405);
}
