import type { Metadata } from "next";
import ProjectsPageClient from "./ProjectsPageClient";

export const metadata: Metadata = {
  title: "Projects | LiTTree-LabStudios",
  description:
    "Connect GitHub repositories and manage your project workspaces.",
};

export default function ProjectsPage() {
  return <ProjectsPageClient />;
}
