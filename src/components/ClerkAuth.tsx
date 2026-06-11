"use client";

import { useUser, UserButton, SignInButton } from "@clerk/nextjs";
import { useClerkAuth } from "@/hooks/useClerkAuth";

type NavAuthProps = {
  linkColor?: string;
};

export function NavAuth({ linkColor = "#6366f1" }: NavAuthProps) {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { user } = useUser();

  if (!isLoaded) {
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

  if (isSignedIn) {
    const firstName = user?.firstName || user?.username || "";
    return (
      <div className="flex items-center gap-1.5">
        {firstName && (
          <span className="text-[11px] font-bold truncate max-w-[80px]" style={{ color: linkColor }}>
            {firstName}
          </span>
        )}
        <UserButton afterSignOutUrl="/" />
      </div>
    );
  }

  return (
    <SignInButton mode="modal">
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
    </SignInButton>
  );
}
