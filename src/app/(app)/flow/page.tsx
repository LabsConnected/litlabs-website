export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

/**
 * /flow is retired — the standalone page simulated pipeline execution
 * client-side (setTimeout animations, random token counts). The real
 * pipeline surface is Studio Mission Forge at /studio?tool=workflows,
 * which posts to /api/flow and renders actual run results.
 */
export default function FlowRedirect() {
  redirect("/studio?tool=workflows");
}
