import type { Metadata } from "next";

import { getDemoConfig } from "@/lib/demo/config";
import DemoStudio from "./DemoStudio";

export const metadata: Metadata = {
  title: "Try LiTT — Limited Demo | LiTT",
  description:
    "Chat with LiTT in a limited public demo inside the real Studio. Sign up free to unlock building, previews, agents, and deploys.",
  robots: { index: false, follow: false },
};

/**
 * /demo — the anonymous limited demo lane.
 *
 * Server component: reads the demo config (kill switch / enabled) and renders
 * the dedicated DemoStudio client component. Never renders CommandStudio and
 * never touches authenticated routes.
 */
export default function DemoPage() {
  const cfg = getDemoConfig();
  const disabled = !cfg.enabled || cfg.killSwitch;
  return (
    <DemoStudio
      maxMessages={cfg.maxMessages}
      disabled={disabled}
      killSwitch={cfg.killSwitch}
    />
  );
}
