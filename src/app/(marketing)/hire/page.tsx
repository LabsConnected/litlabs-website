import HireClient from "./HireClient";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Hire LiTTree — Scoped Creative & Technical Help",
  description:
    "Tell LiTTree LabStudios what you need built. Share the goal, confirm scope and pricing, and start work only after approval.",
  path: "/hire",
  index: true,
});

export default function HirePage() {
  return <HireClient />;
}
