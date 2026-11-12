import ContactClient from "./ContactClient";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Contact",
  description:
    "Get in touch with LiTTree LabStudios — call, text, or send a project inquiry about your new website.",
  path: "/contact",
});

export default function ContactPage() {
  return <ContactClient />;
}
