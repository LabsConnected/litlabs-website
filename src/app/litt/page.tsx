import { Metadata } from "next";
import { LiTTTerminalPage } from "@/components/litt-terminal/LiTTTerminalPage";

export const metadata: Metadata = {
  title: "LiTT Terminal | LiTT Code",
  description: "AI-powered browser terminal for LiTT Code.",
};

export default function LiTTPage() {
  return <LiTTTerminalPage />;
}
