"use client";

import { useAuth, useUser, UserButton, SignInButton } from "@clerk/nextjs";

type NavAuthProps = {
  linkColor?: string;
};

export function NavAuth({ linkColor = "#ff0080" }: NavAuthProps) {
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();

  if (!isLoaded) {
    return (
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          backgroundColor: linkColor + "20",
          border: `1px solid ${linkColor}40`,
          animation: "pulse 1.5s infinite",
        }}
      />
    );
  }

  if (isSignedIn) {
    const firstName = user?.firstName || user?.username || "";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {firstName && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: "bold",
              color: linkColor,
              maxWidth: "80px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
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
        style={{
          padding: "5px 14px",
          fontSize: "11px",
          fontWeight: "bold",
          backgroundColor: linkColor,
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          letterSpacing: "0.05em",
          boxShadow: `0 0 10px ${linkColor}50`,
        }}
      >
        Sign In
      </button>
    </SignInButton>
  );
}
