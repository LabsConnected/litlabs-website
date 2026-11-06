"use client";

/**
 * UmamiAnalytics — Umami Cloud website analytics (www.litlabs.net).
 *
 * Loads the Umami tracker via next/script afterInteractive, but ONLY after
 * the visitor consents to "analytics" cookies — loading tracking scripts
 * before consent is a GDPR violation (see src/lib/cookie-consent.ts).
 * Consent granted or withdrawn mid-session takes effect live via the
 * CONSENT_CHANGED_EVENT dispatch and cross-tab `storage` events.
 *
 * Production-only tracking is enforced two ways:
 *   1. `data-domains` restricts beacons to litlabs.net hostnames — dev,
 *      staging, and preview traffic can never reach the dashboard.
 *   2. Umami's own `umami.disabled` localStorage flag is kept in sync with
 *      consent, so a withdrawal stops sends immediately even though the
 *      script tag stays mounted.
 *
 * Env overrides (all optional, public values):
 *   NEXT_PUBLIC_UMAMI_WEBSITE_ID  — defaults to the litlabs.net site id
 *   NEXT_PUBLIC_UMAMI_SCRIPT_URL  — defaults to cloud.umami.is/script.js
 *   NEXT_PUBLIC_UMAMI_DOMAINS     — defaults to litlabs.net,www.litlabs.net;
 *                                   set "" to allow every hostname
 */
import Script from "next/script";
import { useEffect, useState } from "react";
import { CONSENT_CHANGED_EVENT, hasConsent } from "@/lib/cookie-consent";

const SCRIPT_URL =
  process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL ??
  "https://cloud.umami.is/script.js";
const WEBSITE_ID =
  process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ??
  "89155524-4ee4-4dc1-85d3-1a40839283de";
const DOMAINS =
  process.env.NEXT_PUBLIC_UMAMI_DOMAINS ?? "litlabs.net,www.litlabs.net";

const UMAMI_DISABLED_KEY = "umami.disabled";

export function UmamiAnalytics() {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    const sync = () => {
      const ok = hasConsent("analytics");
      try {
        // The tracker checks localStorage["umami.disabled"] before every
        // send — syncing it makes withdrawal effective immediately.
        if (ok) window.localStorage.removeItem(UMAMI_DISABLED_KEY);
        else window.localStorage.setItem(UMAMI_DISABLED_KEY, "1");
      } catch {
        // localStorage unavailable — the mount gate still applies.
      }
      setConsented(ok);
    };
    sync();
    window.addEventListener(CONSENT_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!consented || !WEBSITE_ID) return null;

  return (
    <Script
      id="umami-analytics"
      src={SCRIPT_URL}
      data-website-id={WEBSITE_ID}
      {...(DOMAINS ? { "data-domains": DOMAINS } : {})}
      strategy="afterInteractive"
    />
  );
}
