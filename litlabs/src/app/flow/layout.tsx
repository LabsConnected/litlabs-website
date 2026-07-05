import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flow",
  description: "Build no-code AI workflows and automate your business processes with LiTTree Flow.",
};

export default function FlowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
