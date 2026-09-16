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
    // /games is live again (retroGameRuntime flag on) but intentionally kept
    // out of the sitemap and noindex for now — soft launch, not an SEO push.
    // /gallery removed — obsolete Artifact Museum page retired
    {
      url: absoluteUrl("/pricing"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: absoluteUrl("/cli"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: absoluteUrl("/docs"),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...[
      "/docs/quick-start",
      "/docs/studio",
      "/docs/building",
      "/docs/preview-deploy",
      "/docs/cli",
      "/docs/marketplace",
      "/docs/safety",
      "/docs/troubleshooting",
    ].map((path) => ({
      url: absoluteUrl(path),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
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