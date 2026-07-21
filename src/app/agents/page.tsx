import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import AgentsPageClient from "./AgentsPageClient";

export default async function AgentsPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/agents");
  }
  return (
    <Suspense fallback={<div className="flex h-full min-h-0 items-center justify-center"><p className="text-sm opacity-60">Loading Base Station…</p></div>}>
      <AgentsPageClient />
    </Suspense>
  );
}
