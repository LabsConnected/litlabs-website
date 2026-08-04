import { redirect } from "next/navigation";

export default function AgentsPage() {
  // Agents page = agent management (configure, view, inspect).
  // Chat with an agent happens in Studio Chat: /studio?tool=chat
  redirect("/studio?tool=agents");
}
