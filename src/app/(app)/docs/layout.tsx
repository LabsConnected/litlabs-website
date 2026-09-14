import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import DocsShell from "./_components/DocsShell";

/**
 * /docs is public documentation (see BARE_PUBLIC_PATHS in LayoutShell.tsx).
 * Every docs route renders inside DocsShell, which provides the section
 * sidebar (desktop), the collapsible section nav (mobile), and the
 * prev/next pager — while MarketingHeader/MarketingFooter keep the
 * surrounding chrome consistent with the rest of the marketing site.
 */
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <MarketingHeader />
      <DocsShell>{children}</DocsShell>
      <MarketingFooter />
    </>
  );
}
