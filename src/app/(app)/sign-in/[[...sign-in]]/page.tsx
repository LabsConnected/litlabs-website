import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

interface SignInPageProps {
  searchParams?: { [key: string]: string | string[] | undefined };
}

/**
 * Render Clerk's SignIn component for the application domain.
 *
 * The OAuth flow (and other Clerk-originated redirects) passes the
 * post-sign-in destination in the `redirect_url` query parameter, which
 * can be a full URL (e.g. `https://www.litlabs.net/oauth-consent?...`).
 *
 * To ensure the user is sent back to the correct OAuth consent route
 * after signing in, we read `redirect_url`, validate it points to a
 * trusted litlabs.net host, and pass the path+query to Clerk's
 * `forceRedirectUrl` prop. If no valid `redirect_url` is provided, the
 * user is sent to `/studio`.
 */
function toRelativeRedirect(redirectUrl: string | string[] | undefined): string {
  if (!redirectUrl || typeof redirectUrl !== "string") {
    return "/studio";
  }

  try {
    const url = new URL(redirectUrl);
    const allowedHosts = ["litlabs.net", "www.litlabs.net", "localhost", "127.0.0.1"];
    if (!allowedHosts.includes(url.hostname)) {
      return "/studio";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Not a full URL — allow relative paths (e.g. "/oauth-consent")
    if (redirectUrl.startsWith("/")) {
      return redirectUrl;
    }
    return "/studio";
  }
}

export default function SignInPage({ searchParams }: SignInPageProps) {
  const redirectUrl = toRelativeRedirect(searchParams?.redirect_url);

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "#0f0f14" }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl mb-3">🚀</div>
          <h1
            className="text-xl font-black tracking-tight mb-1"
            style={{ color: "#e2e8f0" }}
          >
            LiTTree LabStudios
          </h1>
          <p className="text-xs opacity-70" style={{ color: "#94a3b8" }}>
            Sign in to your AI workspace
          </p>
        </div>

        <div
          className="rounded-xl p-1"
          style={{ backgroundColor: "#1a1a24", border: "1px solid #2a2a3a" }}
        >
          <SignIn
            forceRedirectUrl={redirectUrl}
            signUpUrl="/sign-up"
            appearance={{
              elements: {
                formButtonPrimary: {
                  backgroundColor: "#6366f1",
                  color: "#fff",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: "bold",
                  borderRadius: "8px",
                },
                formFieldInput: {
                  backgroundColor: "#0f0f14",
                  border: "1px solid #2a2a3a",
                  color: "#e2e8f0",
                  borderRadius: "8px",
                },
                footerActionLink: { color: "#818cf8" },
                headerTitle: { color: "#e2e8f0" },
                headerSubtitle: { color: "#94a3b8" },
                socialButtonsBlockButton: {
                  border: "1px solid #2a2a3a",
                  backgroundColor: "transparent",
                  borderRadius: "8px",
                },
                card: { backgroundColor: "transparent", boxShadow: "none" },
                formFieldLabel: { color: "#94a3b8", fontSize: "12px" },
                identityPreviewText: { color: "#e2e8f0" },
                alternativeMethodsBlockButton: {
                  border: "1px solid #2a2a3a",
                  color: "#94a3b8",
                  borderRadius: "8px",
                },
              },
              variables: {
                colorPrimary: "#6366f1",
                colorBackground: "#1a1a24",
                colorForeground: "#e2e8f0",
                colorMutedForeground: "#94a3b8",
                colorInput: "#0f0f14",
                colorInputForeground: "#e2e8f0",
                borderRadius: "8px",
                fontFamily: "system-ui, -apple-system, sans-serif",
              },
            }}
          />
        </div>

        <div className="text-center mt-5">
          <Link
            href="/"
            className="text-[11px] opacity-70 hover:opacity-100 transition-opacity"
            style={{ color: "#94a3b8", textDecoration: "none" }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
