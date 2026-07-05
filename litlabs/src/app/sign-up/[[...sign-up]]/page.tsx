import { SignUp } from "@clerk/nextjs";
import { AuthShell, clerkAuthAppearance } from "@/components/auth/AuthShell";

export default function SignUpPage() {
  return (
    <AuthShell
      mode="sign-up"
      headline="Start building with LiTTree OS"
      subcopy="Create your workspace, get 500 starter credits, and launch your first agent."
    >
      <SignUp
        fallbackRedirectUrl="/onboarding"
        signInUrl="/sign-in"
        appearance={clerkAuthAppearance}
      />
    </AuthShell>
  );
}
