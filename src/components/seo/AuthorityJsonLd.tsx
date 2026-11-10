import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/seo";
import { JsonLd } from "./JsonLd";

export function AuthorityJsonLd() {
  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      "name": SITE_NAME,
      "url": SITE_URL,
      "logo": absoluteUrl("/logo.png"),
      "sameAs": [
        "https://x.com/LabsConnected",
        "https://github.com/LabsConnected"
      ],
      "description": "LiTTree LabStudios builds LiTT, the AI Project Operator — an AI software-building workspace for turning ideas into real, ownable projects."
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
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
      "@id": `${SITE_URL}/#studio-application`,
      "name": "LiTTree Studio",
      "applicationCategory": "DeveloperApplication, MultimediaApplication",
      "operatingSystem": "Web",
      "url": absoluteUrl("/studio"),
      "description": "LiTT is the AI Project Operator by LiTTree LabStudios — an AI software-building workspace: describe, generate, preview, edit, verify, and publish real projects.",
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
