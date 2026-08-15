export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

export default function GenerateRedirect() {
  redirect("/studio?tool=image");
}

