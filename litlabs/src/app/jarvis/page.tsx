import { Metadata } from "next";
import { JarvisTerminalPage } from "@/components/jarvis-terminal/JarvisTerminalPage";

export const metadata: Metadata = {
  title: "Jarvis Terminal | LiTTree OS",
  description: "AI-powered browser terminal for LiTTree LabStudios.",
};

export default function JarvisPage() {
  return <JarvisTerminalPage />;
}
