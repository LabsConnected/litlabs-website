import { redirect } from "next/navigation";

export default function MemoriesRedirect() {
  redirect("/studio?tool=memory");
}
