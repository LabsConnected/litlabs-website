import { redirect } from "next/navigation";

export const dynamic = "force-static";

/**
 * /gallery is linked from the navbar, sidebar, footer, and dashboard.
 * The canonical showcase experience now lives at /showcase.
 * Redirect here so every existing /gallery link keeps working.
 */
export default function GalleryPage() {
  redirect("/showcase");
}
