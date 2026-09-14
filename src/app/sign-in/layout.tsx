import type { Metadata } from "next";
import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="litt-landing min-h-dvh text-white">
      <MarketingHeader />
      <div className="pt-[68px]">{children}</div>
      <MarketingFooter />
    </div>
  );
}
