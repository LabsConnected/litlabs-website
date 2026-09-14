import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Hire LiTTree LabStudios — Launch Sprint, Automation, Brand",
  description:
    "Get it done for you. Productized AI services: website launch, automation setup, and brand packs. Bounded scope, clear pricing, fast delivery.",
  openGraph: {
    title: "Hire LiTTree LabStudios",
    description:
      "From idea to live site, AI automation, or brand identity — we do it for you.",
  },
};

export default function HirePage() {
  // /hire is permanently retired from the public V1 product. This redirect
  // is authoritative and unconditional — it must not be gated behind the
  // hireServices feature flag (that flag previously let this route flip
  // back to rendering the retired offer catalog, which conflicted with the
  // decision to retire it). The offer catalog UI (HireClient), its config
  // (@/config/service-offers), and the lead-capture API
  // (/api/leads/service-inquiry) are intentionally left in place in case
  // the services offering is relaunched, but nothing wires them back into
  // this route until that decision is made explicitly.
  redirect("/studio");
}
