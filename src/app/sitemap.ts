import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteConfig";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/studio", priority: 0.9, changeFrequency: "weekly" as const },
    {
      path: "/marketplace",
      priority: 0.9,
      changeFrequency: "daily" as const,
    },
    { path: "/agents", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/gallery", priority: 0.7, changeFrequency: "daily" as const },
    { path: "/social", priority: 0.7, changeFrequency: "daily" as const },
    { path: "/games", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/showcase", priority: 0.6, changeFrequency: "weekly" as const },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/cookies", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/sign-in", priority: 0.4, changeFrequency: "yearly" as const },
    { path: "/sign-up", priority: 0.5, changeFrequency: "yearly" as const },
  ];

  return staticRoutes.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
