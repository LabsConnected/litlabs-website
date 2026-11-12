export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

export default function AgentRedirect() {
  // Owner ruling 2026-11-12 (#627): no separate Agents tab — Agents lives
  // inside Studio only. Retarget straight into Studio instead of bouncing
  // through the standalone /agents page.
  redirect("/studio?tool=agents");
}
