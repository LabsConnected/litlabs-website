import { redirect } from "next/navigation";

export default function AgentRedirect() {
  redirect("/studio?tool=agents");
}
