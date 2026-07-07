import { redirect } from "next/navigation";

export default function AIBuilderPage() {
  redirect("/studio?tool=chat");
}
