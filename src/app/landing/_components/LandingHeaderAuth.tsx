"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NavAuth } from "@/components/ClerkAuth";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Component, type ReactNode, useEffect, useState } from "react";

class AuthBoundary extends Component<{ children: ReactNode }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <Link
          href="/sign-in"
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-bold text-indigo-300 border border-indigo-400/40 bg-indigo-400/10 transition hover:bg-indigo-400/20"
        >
          Sign In
        </Link>
      );
    }
    return this.props.children;
  }
}

/** Skeleton placeholder matching button height — avoids hydration mismatch on static pages */
function AuthPlaceholder() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-9 w-20 animate-pulse rounded-xl bg-white/5" />
      <div className="h-9 w-24 animate-pulse rounded-xl bg-white/10" />
    </div>
  );
}

function AuthButtons() {
  const { isSignedIn, isLoaded } = useClerkAuth();
  return (
    <div className="flex items-center gap-2">
      <NavAuth linkColor="#a5b4fc" />
      {(!isLoaded || !isSignedIn) && (
        <Link
          href="/sign-up"
          className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-black shadow-lg shadow-white/10 transition hover:bg-neutral-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          Start free <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}

export function LandingHeaderAuth() {
  // The landing page is statically prerendered, so the initial HTML always
  // shows the signed-out state. Render a placeholder on first paint, then
  // mount the real auth component after hydration so Clerk can detect the
  // actual session client-side without a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <AuthPlaceholder />;

  return (
    <AuthBoundary>
      <AuthButtons />
    </AuthBoundary>
  );
}
