"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import Link from "next/link";
import dynamic from "next/dynamic";

// Dynamically import to avoid SSR issues
const NeuralImagingStudio = dynamic(
  () => import("@/components/NeuralImagingStudio"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="text-orange-500 animate-pulse">
          Loading Neural Studio...
        </div>
      </div>
    ),
  },
);

export default function StudioImagePage() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/studio/image");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="text-orange-500 animate-pulse">
          Loading Neural Studio...
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center gap-4">
        <p className="text-white/60 text-sm">
          Please sign in to use Neural Studio.
        </p>
        <Link
          href="/sign-in?redirect_url=/studio/image"
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ backgroundColor: "#6366f1", color: "#fff" }}
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505]">
      <NeuralImagingStudio />
    </div>
  );
}
