import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";

/**
 * /docs is public documentation (see BARE_PUBLIC_PATHS in LayoutShell.tsx)
 * but previously rendered with no header/footer at all. Give it the same
 * shared MarketingHeader/MarketingFooter every other public marketing page
 * uses, without pulling in the (marketing) route group's providers or
 * moving the route — LayoutShell/AppLayout already provide what this page
 * needs.
 */
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </>
  );
}
