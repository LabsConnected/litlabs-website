import { SignIn } from "@clerk/nextjs";
import { AuthShell, clerkAuthAppearance } from "@/components/auth/AuthShell";

export default function SignInPage() {
  return (
    <AuthShell
      mode="sign-in"
      headline="Welcome back"
      subcopy="Sign in to continue building inside LiTTree OS."
    >
      <SignIn
        fallbackRedirectUrl="/dashboard"
        signUpUrl="/sign-up"
        appearance={clerkAuthAppearance}
      />
    </AuthShell>
  );
}
