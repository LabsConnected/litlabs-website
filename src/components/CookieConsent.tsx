"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  COOKIE_CONSENT_OPEN_EVENT,
  getConsent,
  saveConsent,
  type OptionalCookieChoices,
} from "@/lib/cookie-consent";

const ESSENTIAL_ONLY: OptionalCookieChoices = {
  preferences: false,
  analytics: false,
  marketing: false,
};

export default function CookieConsent() {
  const { resolvedColors: T } = useTheme();
  const [visible, setVisible] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [choices, setChoices] = useState<OptionalCookieChoices>(ESSENTIAL_ONLY);

  // Hydration-safe: consult localStorage only after mounting in the browser.
  useEffect(() => {
    const existing = getConsent();
    if (existing) {
      setChoices({
        preferences: existing.preferences,
        analytics: existing.analytics,
        marketing: existing.marketing,
      });
    }
    setVisible(!existing);

    const reopen = () => {
      const latest = getConsent();
      setChoices(latest ? {
        preferences: latest.preferences,
        analytics: latest.analytics,
        marketing: latest.marketing,
      } : ESSENTIAL_ONLY);
      setCustomizing(true);
      setVisible(true);
    };

    window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, reopen);
  }, []);

  const commit = (value: OptionalCookieChoices) => {
    saveConsent(value);
    setChoices(value);
    setVisible(false);
    setCustomizing(false);
  };

  if (!visible) return null;

  const outline = {
    borderColor: T.borderColor,
    color: T.textColor,
    backgroundColor: "transparent",
  };
  const primary = {
    borderColor: T.accentColor,
    backgroundColor: T.accentColor,
    color: T.bgColor,
  };

  return (
    <section
      aria-label="Cookie privacy choices"
      className="fixed inset-x-3 bottom-3 z-[10000] mx-auto w-auto max-w-md rounded-2xl border p-4 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:mx-0 sm:w-[420px] sm:p-5"
      style={{
        borderColor: T.accentColor,
        backgroundColor: T.boxBg,
        color: T.textColor,
        boxShadow: `0 18px 55px rgba(0,0,0,.28), 0 0 24px ${T.accentColor}18`,
      }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-xl">🍪</span>
        <div className="min-w-0 flex-1">
          <h2 className="mb-1 text-sm font-bold" style={{ color: T.headerColor }}>
            Your privacy choices
          </h2>
          <p className="text-xs leading-relaxed opacity-80">
            Essential storage keeps sign-in and Studio working. You can choose
            whether to allow optional preferences and usage analytics.
          </p>
          {customizing && (
            <fieldset className="mt-4 space-y-2 rounded-xl border p-3" style={{ borderColor: T.borderColor }}>
              <legend className="px-1 text-xs font-semibold">Optional categories</legend>
              <div className="flex items-center justify-between gap-3 border-b pb-2 text-xs" style={{ borderColor: T.borderColor }}>
                <span>Essential</span>
                <span className="font-semibold opacity-70">Always on</span>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-xs">
                <span><strong>Preferences</strong><span className="block opacity-70">Remember optional interface choices</span></span>
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0"
                  style={{ accentColor: T.accentColor }}
                  checked={choices.preferences}
                  onChange={(event) => setChoices((prev) => ({ ...prev, preferences: event.target.checked }))}
                />
              </label>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-xs">
                <span><strong>Analytics</strong><span className="block opacity-70">Help us understand how LiTT is used</span></span>
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0"
                  style={{ accentColor: T.accentColor }}
                  checked={choices.analytics}
                  onChange={(event) => setChoices((prev) => ({ ...prev, analytics: event.target.checked }))}
                />
              </label>
              <p className="text-[11px] leading-relaxed opacity-65">
                No marketing trackers are currently in use.
              </p>
            </fieldset>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => commit({ preferences: true, analytics: true, marketing: false })}
              className="min-h-11 flex-1 rounded-lg border px-3 py-2 text-xs font-semibold motion-safe:transition-opacity hover:opacity-85"
              style={primary}
            >
              Accept all
            </button>
            <button
              type="button"
              onClick={() => commit(ESSENTIAL_ONLY)}
              className="min-h-11 flex-1 rounded-lg border px-3 py-2 text-xs font-semibold motion-safe:transition-opacity hover:opacity-85"
              style={outline}
            >
              Essential only
            </button>
            {customizing ? (
              <button
                type="button"
                onClick={() => commit({ ...choices, marketing: false })}
                className="min-h-11 w-full rounded-lg border px-3 py-2 text-xs font-semibold motion-safe:transition-opacity hover:opacity-85"
                style={primary}
              >
                Save my choices
              </button>
            ) : (
              <button
                type="button"
                aria-expanded={customizing}
                onClick={() => setCustomizing(true)}
                className="min-h-11 w-full rounded-lg border px-3 py-2 text-xs font-semibold motion-safe:transition-opacity hover:opacity-85"
                style={outline}
              >
                Customize
              </button>
            )}
          </div>
          <a href="/cookies" className="mt-3 inline-block rounded text-xs underline underline-offset-2 focus-visible:outline focus-visible:outline-2" style={{ color: T.linkColor }}>
            Read the cookie policy
          </a>
        </div>
      </div>
    </section>
  );
}
