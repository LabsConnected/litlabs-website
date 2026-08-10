import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/seo";
import { JsonLd } from "./JsonLd";

export function AuthorityJsonLd() {
  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": SITE_NAME,
      "url": SITE_URL,
      "logo": absoluteUrl("/logo.png"),
      "sameAs": [
        "https://x.com/LabsConnected",
        "https://github.com/LabsConnected"
      ],
      "description": "LiTTree LabStudios is an AI creative platform for building apps, creating media, and preserving project context."
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": SITE_NAME,
      "url": SITE_URL,
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": `${SITE_URL}/studio?q={search_term_string}`
        },
        "query-input": "required name=search_term_string"
      }
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": "LiTTree Studio",
      "applicationCategory": "DeveloperApplication, MultimediaApplication",
      "operatingSystem": "Web",
      "url": absoluteUrl("/studio"),
      "description": "An AI-powered creative operating system for building apps and creating media.",
      "creator": {
        "@type": "Organization",
        "name": SITE_NAME
      },
      "featureList": [
        "AI Build Workflow",
        "Media Forge",
        "Project Memory",
        "Real-time Previews",
        "Human Approval Governance"
      ],
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      }
    }
  ];

  return <JsonLd data={schemas} />;
}
