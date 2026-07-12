import { redirect } from "next/navigation";

export default function ChatRedirect() {
  redirect("/studio?tool=chat");
}
