import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Social",
  description:
    "Connect with creators, share your AI-generated content, and join the LiTTree-LabStudios community.",
};

export default function SocialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
