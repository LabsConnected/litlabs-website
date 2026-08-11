export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

export default function AiBuilderRedirect() {
  redirect("/studio?tool=workflows");
}
