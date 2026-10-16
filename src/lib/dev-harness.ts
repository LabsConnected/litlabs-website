import { notFound } from "next/navigation";
import { isDevHarnessEnabled } from "@/lib/dev-harness-env";

export { DEV_HARNESS_FLAG, isDevHarnessEnabled } from "@/lib/dev-harness-env";

/** 404 harness routes in production unless `LITT_ENABLE_DEV_HARNESS=1`. */
export function guardDevHarnessRoute(): void {
  if (!isDevHarnessEnabled()) notFound();
}
