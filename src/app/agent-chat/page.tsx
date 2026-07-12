import { redirect } from "next/navigation";

export default function AgentChatRedirect() {
  redirect("/studio?tool=chat");
}
