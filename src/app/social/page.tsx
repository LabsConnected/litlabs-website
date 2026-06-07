// Social feed has been merged into the home page (/) — redirect visitors there.
import { redirect } from "next/navigation";

export default function SocialPage() {
  redirect("/");
}
