import { gatePublicTestPage } from "@/lib/public-test-pages";
import VisualHarnessClient from "./VisualHarnessClient";

export const dynamic = "force-dynamic";

export default function VisualHarnessPage() {
  gatePublicTestPage();
  return <VisualHarnessClient />;
}
