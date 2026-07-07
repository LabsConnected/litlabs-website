"use client";

import { useEffect } from "react";

const STORAGE_KEY = "littree-signup-attribution";

export type SignupAttribution = {
  source: string;
  referrer: string;
  landingPath: string;
  utm: Record<string, string>;
  capturedAt: string;
};

export function getSignupAttribution(): SignupAttribution | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as SignupAttribution) : null;
  } catch {
    return null;
  }
}

export default function SignupAttributionTracker() {
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;

      const params = new URLSearchParams(window.location.search);
      const utm: Record<string, string> = {};
      for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"]) {
        const value = params.get(key);
        if (value) utm[key] = value;
      }

      const referrer = document.referrer || "";
      const source =
        params.get("utm_source") ||
        params.get("ref") ||
        (referrer ? new URL(referrer).hostname.replace(/^www\./, "") : "direct");

      const attribution: SignupAttribution = {
        source,
        referrer,
        landingPath: `${window.location.pathname}${window.location.search}`,
        utm,
        capturedAt: new Date().toISOString(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
    } catch {
      // Attribution is helpful, never blocking.
    }
  }, []);

  return null;
}
