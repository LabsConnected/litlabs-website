import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your LiTT Code profile. Showcase your AI creations and connect with other builders.",
};

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
