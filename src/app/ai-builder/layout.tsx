import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Builder",
  description:
    "Build custom AI agents and workflows with the LiTTree-LabStudios AI Builder.",
};

export default function AiBuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
