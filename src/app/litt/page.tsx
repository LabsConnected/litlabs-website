import { Metadata } from "next";
import { LiTTTerminalPage } from "@/components/litt-terminal/LiTTTerminalPage";

export const metadata: Metadata = {
  title: "LiTT Terminal | LiTTree OS",
  description: "AI-powered browser terminal for LiTTree LabStudios.",
};

export default function JarvisPage() {
  return <LiTTTerminalPage />;
}
