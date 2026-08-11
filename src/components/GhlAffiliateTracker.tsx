"use client";

/**
 * GhlAffiliateTracker — HighLevel Affiliate Manager integration.
 *
 * Two parts:
 *
 * 1. GhlAffiliateScript (exported as default)
 *    Visitor tracking — loads GHL `am.js` on every page and calls
 *    `affiliateManager.init()` so the `am_id` cookie is set when a
 *    visitor arrives via an affiliate referral link.
 *    No Clerk dependency — safe to render outside ClerkProvider.
 *
 * 2. GhlAffiliateSignupTracker (named export)
 *    Signup tracking — uses Clerk's `useUser()` to detect signed-in
 *    users and calls the SERVER endpoint /api/affiliate/track-lead
 *    which enforces idempotency via the `ghl_lead_tracked` DB column.
 *    This is truly one-time per Clerk user, not per browser session.
 *    MUST be rendered inside <ClerkProvider>.
 *
 * Campaign: LiTTree Partner Program
 * Location ID: sT0yL2XFTU0l87Ooce3h
 *
 * am_id preservation:
 *   The am_id is captured from the URL query param (?am_id=...) on
 *   first visit and stored in localStorage. This survives Clerk
 *   signup redirects (which navigate away from the original URL).
 *   The server endpoint receives the am_id and passes it to GHL.
 */
import Script from "next/script";
import { useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";

const GHL_LOCATION_ID = "sT0yL2XFTU0l87Ooce3h";
const GHL_BACKEND_URL = "https://backend.leadconnectorhq.com";
const GHL_COOKIE_DOMAIN = ".litlabs.net";
const GHL_AM_SCRIPT_SRC = "https://link.msgsndr.com/js/am.js";

// localStorage key for preserving am_id across Clerk redirects.
// This is NOT the idempotency marker — the server DB is the source
// of truth for that. This only preserves the attribution ID.
const AM_ID_STORAGE_KEY = "litt:ghl:am_id";

declare global {
  interface Window {
    affiliateManager?: {
      init: (locationId: string, backendUrl: string, cookieDomain: string) => void;
      trackLead: (
        data: {
          firstName?: string;
          lastName?: string;
          email?: string;
          uid?: string;
        },
        callback?: () => void,
      ) => void;
    };
  }
}

/**
 * Capture am_id from the URL on first load, before any redirect.
 * Called at module scope so it runs immediately on client hydration.
 */
function captureAmIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const params = new URLSearchParams(window.location.search);
    const amId = params.get("am_id") || params.get("amid");

    if (amId) {
      // Persist so it survives Clerk signup redirects
      localStorage.setItem(AM_ID_STORAGE_KEY, amId);
      return amId;
    }

    // Also check the GHL cookie (set by am.js)
    const cookieMatch = document.cookie.match(/am_id=([^;]+)/);
    if (cookieMatch?.[1]) {
      localStorage.setItem(AM_ID_STORAGE_KEY, cookieMatch[1]);
      return cookieMatch[1];
    }

    // Fall back to previously captured am_id
    return localStorage.getItem(AM_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

// ─── Part 1: Visitor Tracking Script ────────────────────────────
// No Clerk dependency — safe to render anywhere in the body.

export function GhlAffiliateScript() {
  // Capture am_id immediately on mount, before any navigation
  useEffect(() => {
    captureAmIdFromUrl();
  }, []);

  return (
    <Script
      id="ghl-affiliate-am"
      src={GHL_AM_SCRIPT_SRC}
      strategy="afterInteractive"
      onLoad={() => {
        try {
          window.affiliateManager?.init(
            GHL_LOCATION_ID,
            GHL_BACKEND_URL,
            GHL_COOKIE_DOMAIN,
          );
        } catch {
          // Silent fail — affiliate tracking must never break the app
        }
      }}
    />
  );
}

// ─── Part 2: Signup Tracking ────────────────────────────────────
// Uses Clerk's useUser() — MUST be rendered inside <ClerkProvider>.
//
// The server endpoint enforces idempotency — we can safely call it
// on every sign-in without worrying about duplicate leads.

export function GhlAffiliateSignupTracker() {
  const { isLoaded, isSignedIn, user } = useUser();
  const callInFlightRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (callInFlightRef.current) return;

    const primaryEmail = user.primaryEmailAddress?.emailAddress;
    if (!primaryEmail) return;

    callInFlightRef.current = true;

    // Capture am_id from URL or localStorage (preserved across redirects)
    const amId = captureAmIdFromUrl();

    // Call the server endpoint — it checks the DB and only submits
    // to GHL if this user hasn't been tracked yet.
    fetch("/api/affiliate/track-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amId,
        email: primaryEmail,
        firstName: user.firstName ?? undefined,
        lastName: user.lastName ?? undefined,
      }),
      keepalive: true,
    })
      .then((res) => res.json())
      .then((data: { tracked?: boolean; replayed?: boolean; reason?: string }) => {
        // Log the result for debugging — no sensitive data
        if (data.tracked && !data.replayed) {
          console.info(`[ghl] Lead tracked for user ${user.id}${amId ? ` amId=${amId}` : ""}`);
        } else if (data.replayed) {
          // Already tracked — this is the expected path for existing users
          console.info(`[ghl] Lead already tracked for user ${user.id}, skipping`);
        } else if (!data.tracked && data.reason) {
          console.warn(`[ghl] Lead tracking failed for user ${user.id}: ${data.reason}`);
        }
      })
      .catch((err) => {
        // Network error — will retry on next sign-in
        console.warn(`[ghl] track-lead request failed: ${err instanceof Error ? err.message : "network error"}`);
      })
      .finally(() => {
        callInFlightRef.current = false;
      });
  }, [isLoaded, isSignedIn, user]);

  return null;
}
