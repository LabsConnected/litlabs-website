import { Metadata } from "next";

export const metadata: Metadata = {
  title: "LiTTree Core | LiTTree LabStudios",
  description: "Main AI command center for LiTTree LabStudios.",
};

export default function LiTTreeRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
