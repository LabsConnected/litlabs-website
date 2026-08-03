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
      url: absoluteUrl("/marketplace"),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: absoluteUrl("/gallery"),
      changeFrequency: "daily",
      priority: 0.8,
    },
    // /discover removed — community features disabled for v1
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