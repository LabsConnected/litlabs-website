import { notFound } from "next/navigation";
import { isPublicTestPageBlocked } from "@/lib/public-test-pages";
import VisualHarnessClient from "./VisualHarnessClient";

export const dynamic = "force-dynamic";

export default function VisualHarnessPage() {
  if (isPublicTestPageBlocked()) notFound();
  return <VisualHarnessClient />;
}
