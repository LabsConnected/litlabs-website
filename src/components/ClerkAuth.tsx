"use client";

import Link from "next/link";
import { Component, type ReactNode, useState, useEffect } from "react";
import { UserButton, SignInButton } from "@clerk/nextjs";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import { LogIn } from "lucide-react";

type NavAuthProps = {
  linkColor?: string;
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/* Error boundary catches Clerk hook errors when ClerkProvider is absent */
class ClerkBoundary extends Component<{
  fallback: ReactNode;
  children: ReactNode;
}> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function useCustomSession() {
  const [session, setSession] = useState<{
    user?: { name?: string | null };
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setSession(data);
        setLoaded(true);
      })
      .catch(() => {
        setSession(null);
        setLoaded(true);
      });
  }, []);
  return { session, loaded };
}

function CustomAuthFallback({ linkColor }: NavAuthProps) {
  const { session, loaded } = useCustomSession();
  if (!loaded) {
    return (
      <div
        className="rounded-full animate-pulse"
        style={{
          width: 28,
          height: 28,
          backgroundColor: linkColor + "20",
          border: `1px solid ${linkColor}40`,
        }}
      />
    );
  }
  if (session?.user) {
    const name = session.user.name || "Admin";
    return (
      <div className="flex items-center gap-1.5">
        <span
          className="text-[11px] font-bold truncate max-w-[80px]"
          style={{ color: linkColor }}
        >
          {name}
        </span>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            aria-label="Sign out"
            className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black cursor-pointer hover:opacity-80 transition-opacity"
            style={{
              backgroundColor: linkColor + "20",
              color: linkColor,
              border: `1px solid ${linkColor}40`,
            }}
            title="Sign out"
          >
            ✕
          </button>
        </form>
      </div>
    );
  }
  return (
    <Link href="/sign-in">
      <button
        className="px-3.5 py-1.5 rounded-md text-[11px] font-bold cursor-pointer transition-all hover:opacity-90"
        style={{
          backgroundColor: linkColor,
          color: "#fff",
          letterSpacing: "0.05em",
        }}
      >
        Sign In
      </button>
    </Link>
  );
}

function AuthInner({ linkColor }: NavAuthProps) {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { user } = useAppUser();

  if (!isLoaded) {
    return (
      <div
        className="h-9 w-24 rounded-xl animate-pulse"
        style={{
          backgroundColor: linkColor + "18",
          border: `1px solid ${linkColor}30`,
        }}
      />
    );
  }

  if (isSignedIn) {
    const firstName = user?.firstName || user?.username || "You";
    const initial = firstName.charAt(0).toUpperCase();
    return (
      <div
        className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-colors"
        style={{
          backgroundColor: linkColor + "12",
          border: `1px solid ${linkColor}30`,
        }}
      >
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white"
          style={{
            background: `linear-gradient(135deg, ${linkColor}, #a855f7)`,
          }}
        >
          {initial}
        </div>
        <span
          className="text-[12px] font-semibold truncate max-w-[72px]"
          style={{ color: linkColor }}
        >
          {firstName}
        </span>
        <UserButton afterSignOutUrl="/" />
      </div>
    );
  }

  return (
    <SignInButton mode="redirect" forceRedirectUrl="/studio">
      <button
        className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-bold cursor-pointer transition-all hover:scale-[1.03] active:scale-[0.98]"
        style={{
          background: `linear-gradient(135deg, ${linkColor}22, #a855f722)`,
          color: linkColor,
          border: `1px solid ${linkColor}50`,
          letterSpacing: "0.02em",
        }}
      >
        <LogIn size={13} />
        Sign In
      </button>
    </SignInButton>
  );
}

export function NavAuth({ linkColor = "#6366f1" }: NavAuthProps) {
  if (!clerkConfigured) {
    return <CustomAuthFallback linkColor={linkColor} />;
  }

  return (
    <ClerkBoundary fallback={<CustomAuthFallback linkColor={linkColor} />}>
      <AuthInner linkColor={linkColor} />
    </ClerkBoundary>
  );
}
