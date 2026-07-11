import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your LiTT Code account settings, preferences, and connected services.",
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
