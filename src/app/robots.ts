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
          "/agent-chat/",
          "/builder/",
          "/chat/",
          "/code/",
          "/creator/",
          "/dashboard/",
          "/deployments/",
          "/flow/",
          "/generate/",
          "/library/",
          "/litt/",
          "/litt-terminal/",
          "/memories/",
          "/order/",
          "/profile/",
          "/projects/",
          "/resources/",
          "/runtime-test/",
          "/settings/",
          "/sign-in/",
          "/sign-up/",
          "/studio/",
          "/voice/",
          "/wallet/",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
