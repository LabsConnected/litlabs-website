import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import AgentsPageClient from "./AgentsPageClient";

export default async function AgentsPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/agents");
  }
  return <AgentsPageClient />;
}
