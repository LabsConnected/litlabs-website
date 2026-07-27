import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/internal/",
          "/studio/",
          "/dashboard/",
          "/settings/",
          "/profile/",
          "/wallet/",
          "/projects/",
          "/deployments/",
          "/showcase/",
          "/library/",
          "/memories/",
          "/voice/",
          "/order/",
          "/agent/",
          "/agent-chat/",
          "/flow/",
          "/code/",
          "/ai-builder/",
          "/builder/",
          "/chat/",
          "/litt/",
          "/litt-terminal/",
          "/generate/",
          "/sign-in/",
          "/sign-up/",
          "/login/",
          "/creator/",
          "/resources/",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
