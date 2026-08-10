import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/about"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: absoluteUrl("/marketplace"),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: absoluteUrl("/games"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    // /gallery removed — obsolete Artifact Museum page retired
    {
      url: absoluteUrl("/pricing"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: absoluteUrl("/docs"),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: absoluteUrl("/showcase"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...["artist-launch-site", "small-business-dashboard", "music-campaign"].map(
      (slug) => ({
        url: absoluteUrl(`/showcase/${slug}`),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      }),
    ),
    {
      url: absoluteUrl("/privacy"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/terms"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/cookies"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  return staticPages;
}