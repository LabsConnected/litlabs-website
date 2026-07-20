import { redirect } from "next/navigation";

export default function StudioBuilderPage() {
  // Canonical Studio is /studio. Preserve any query params (e.g., ?mode=code&project=...)
  redirect("/studio");
}
