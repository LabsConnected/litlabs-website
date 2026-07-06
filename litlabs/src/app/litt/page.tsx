import type { Metadata } from "next";
import { LiTTHub } from "@/components/litt/LiTTHub";
import { LITT } from "@/components/litt/litt-theme";

export const metadata: Metadata = {
  title: "LiTT Studio Hub",
  description:
    "Chat with LiTT, the model-agnostic AI mascot for LiTTree Lab Studios.",
};

export default function LiTTPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: LITT.bg }}>
      <LiTTHub />
    </main>
  );
}
