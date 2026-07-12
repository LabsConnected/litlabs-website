"use client";

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { LiTTTerminalPage } from "@/components/litt-terminal/LiTTTerminalPage";

function StudioHub() {
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#050505] text-white">
        Loading Studio…
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Link
          href="/sign-in?redirect_url=/studio"
          className="rounded-xl px-4 py-2 font-bold text-white bg-cyan-500 hover:bg-cyan-400"
        >
          Sign in to continue
        </Link>
      </div>
    );
  }

  return <LiTTTerminalPage />;
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center bg-[#050505] text-white">
          Loading Studio…
        </div>
      }
    >
      <StudioHub />
    </Suspense>
  );
}
