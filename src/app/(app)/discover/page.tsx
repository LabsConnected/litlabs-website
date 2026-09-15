"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import SocialPageContent from "@/components/SocialPageContent";
import { useTheme } from "@/context/ThemeContext";
import { Loader2 } from "lucide-react";

// If the auth provider never reports isLoaded (slow/blocked script,
// network blip), stop spinning after a bound and offer a retry instead
// of hanging indefinitely.
const AUTH_LOAD_TIMEOUT_MS = 8000;

export default function DiscoverPage() {
  const { isLoaded } = useClerkAuth();
  const { tokens } = useTheme();
  const [authTimedOut, setAuthTimedOut] = useState(false);

  useEffect(() => {
    if (isLoaded || authTimedOut) return;
    const id = setTimeout(() => setAuthTimedOut(true), AUTH_LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [isLoaded, authTimedOut]);

  if (!isLoaded) {
    if (authTimedOut) {
      return (
        <div
          className="flex min-h-screen items-center justify-center p-6"
          style={{ backgroundColor: tokens.background, color: tokens.textMuted }}
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="text-sm" style={{ color: tokens.text }}>
              Discover is taking longer than expected to load.
            </span>
            <button
              type="button"
              onClick={() => {
                // Re-arm the bound so a still-stalled provider surfaces
                // this fallback again, then force a real reload so the
                // auth provider re-initializes from scratch.
                setAuthTimedOut(false);
                window.location.reload();
              }}
              className="rounded-lg border px-4 py-2 text-sm"
              style={{
                borderColor: tokens.border,
                color: tokens.textMuted,
              }}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ backgroundColor: tokens.background, color: tokens.textMuted }}
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2
            size={24}
            className="animate-spin"
            style={{ color: tokens.primary }}
          />
          <span className="text-xs font-bold uppercase tracking-wider">
            Loading discover feed
          </span>
        </div>
      </div>
    );
  }

  return <SocialPageContent />;
}
