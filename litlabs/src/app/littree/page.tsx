import { Metadata } from "next";
import { LiTTreeCorePage } from "@/components/littree/LiTTreeCorePage";

export const metadata: Metadata = {
  title: "LiTTree Core | LiTTree LabStudios",
  description: "Main AI command center for LiTTree LabStudios.",
};

export default function LiTTreePage() {
  return <LiTTreeCorePage />;
}
