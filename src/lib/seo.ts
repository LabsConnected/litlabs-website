import type { Metadata } from "next";
import { SITE_URL } from "@/lib/siteConfig";

export { SITE_URL };

export const SITE_NAME = "LiTTree LabStudios";

export const DEFAULT_TITLE =
  "LiTTree LabStudios | AI Creative Operating System & Social Creator Platform";

export const DEFAULT_DESCRIPTION =
  "LiTTree LabStudios is an AI creative operating system and social creator platform for turning ideas into real, editable, publishable work. Free to join with no credit card required.";

export const DEFAULT_OG_IMAGE = "/og/littree-labstudios.jpg";

export function absoluteUrl(path = "/"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalizedPath}`;
}

type BuildMetadataOptions = {
  title?: string;
  description?: string;
  path: string;
  index?: boolean;
};

export function buildMetadata({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  index = true,
}: BuildMetadataOptions): Metadata {
  const canonical = absoluteUrl(path);
  // Return the raw title only — the root layout's title.template adds
  // "| LiTTree LabStudios". For the homepage default, DEFAULT_TITLE already
  // includes the site name and is set as an absolute title (bypassing template).
  const resolvedTitle = title ?? DEFAULT_TITLE;
  // OG/Twitter titles should be the full title (template doesn't apply to OG)
  const fullTitle = title ? `${title} | ${SITE_NAME}` : DEFAULT_TITLE;

  return {
    title: resolvedTitle,
    description,
    alternates: {
      canonical,
    },
    robots: {
      index,
      follow: index,
      googleBot: {
        index,
        follow: index,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      images: [
        {
          url: absoluteUrl(DEFAULT_OG_IMAGE),
          width: 1200,
          height: 630,
          alt: fullTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [absoluteUrl(DEFAULT_OG_IMAGE)],
    },
  };
}
