"use client";

import { openCookiePreferences } from "@/lib/cookie-consent";

/** Reopens the shared consent panel already mounted by the site layout. */
export default function CookiePreferencesButton() {
  return (
    <button
      type="button"
      onClick={openCookiePreferences}
      className="mt-3 min-h-11 rounded-lg border px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2"
      style={{
        borderColor: "var(--border-color)",
        color: "var(--link-color)",
        backgroundColor: "var(--bg-card)",
      }}
    >
      Change cookie preferences
    </button>
  );
}
