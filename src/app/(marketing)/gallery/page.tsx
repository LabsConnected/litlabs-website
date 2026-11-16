import GalleryClient from "./GalleryClient";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Gallery",
  description:
    "Public creations shared by LiTT users, with product demos available in the Showcase.",
  path: "/gallery",
  index: false,
});

export default function GalleryPage() {
  return <GalleryClient />;
}
