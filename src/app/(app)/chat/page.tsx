export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { buildChatRedirectUrl, type ChatSearchParams } from "@/lib/chat/redirect";

export default async function ChatRedirect({
  searchParams,
}: {
  searchParams: Promise<ChatSearchParams>;
}) {
  redirect(buildChatRedirectUrl(await searchParams));
}
