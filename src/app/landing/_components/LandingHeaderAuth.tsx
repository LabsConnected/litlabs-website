"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NavAuth } from "@/components/ClerkAuth";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Component, type ReactNode } from "react";

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
  return (
    <AuthBoundary>
      <AuthButtons />
    </AuthBoundary>
  );
}
