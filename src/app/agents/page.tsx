import { redirect } from "next/navigation";

export default function AgentsPage() {
  redirect("/studio?tool=workflows");
}
