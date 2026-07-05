import { SignIn } from "@clerk/nextjs";
import { AuthShell, clerkAuthAppearance } from "@/components/auth/AuthShell";

export default function SignInPage() {
  return (
    <AuthShell
      mode="sign-in"
      headline="Welcome back to your AI workspace"
      subcopy="Continue building agents, workflows, media, and marketplace listings."
    >
      <SignIn
        fallbackRedirectUrl="/dashboard"
        signUpUrl="/sign-up"
        appearance={clerkAuthAppearance}
      />
    </AuthShell>
  );
}
