import { OAuthConsent, Show } from "@clerk/nextjs";
import type { Metadata } from "next";

/**
 * Custom OAuth consent page.
 *
 * Hosts Clerk's prebuilt <OAuthConsent/> component on the application
 * domain (www.litlabs.net) instead of relying on the Account Portal
 * (accounts.litlabs.net) to recognize the user's session.
 *
 * The component reads OAuth parameters (client_id, scope, redirect_uri,
 * state, code_challenge, code_challenge_method) from the current URL's
 * query string automatically — no manual prop wiring is needed.
 *
 * <Show when="signed-in"> renders the consent UI only for authenticated
 * users. When signed out, Clerk's middleware redirects to /sign-in
 * with the full OAuth consent URL preserved as the post-sign-in return
 * destination.
 *
 * Referrer policy: strict-origin-when-cross-origin is REQUIRED by Clerk
 * for OAuth consent flows. The cross-origin POST to FAPI must include
 * the Origin header so Clerk can validate the CSRF token.
 */
export const metadata: Metadata = {
  referrer: "strict-origin-when-cross-origin",
};

export default function OAuthConsentPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "#03050b" }}
    >
      <Show when="signed-in">
        <OAuthConsent
          appearance={{
            variables: {
              colorPrimary: "#a970ff",
              colorBackground: "#060914",
              colorForeground: "#eef4ff",
              colorMutedForeground: "#9ba7c7",
              colorDanger: "#ef4444",
              colorSuccess: "#22c55e",
              borderRadius: "8px",
            },
            elements: {
              card: {
                backgroundColor: "#090d1b",
                border: "1px solid #29345e",
                boxShadow:
                  "0 24px 70px rgba(0,0,0,.55), 0 0 38px rgba(169,112,255,.12)",
              },
            },
          }}
        />
      </Show>
    </div>
  );
}
