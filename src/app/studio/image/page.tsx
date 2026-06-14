"use client";

import dynamic from "next/dynamic";

// Dynamically import to avoid SSR issues
const NeuralImagingStudio = dynamic(
  () => import("@/components/NeuralImagingStudio"),
  { 
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="text-orange-500 animate-pulse">Loading Neural Studio...</div>
      </div>
    )
  }
);

export default function StudioImagePage() {
  return (
    <div className="min-h-screen bg-[#050505]">
      <NeuralImagingStudio />
    </div>
  );
}
