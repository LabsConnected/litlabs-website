import { redirect } from "next/navigation";
export default function BuilderRedirect() {
  redirect("/studio?tool=agents");
}