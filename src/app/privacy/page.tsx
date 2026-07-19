import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | LiTTree LabStudios",
  description: "Privacy Policy for LiTTree LabStudios AI Agent Platform.",
};

export default function PrivacyPage() {
  return (
    <div
      className="min-h-dvh pb-20 font-mono text-xs"
      style={{ backgroundColor: "var(--bg-color)", color: "var(--text-color)" }}
    >
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div
          className="lit-box p-6 mb-8"
          style={{
            borderColor: "var(--border-color)",
            backgroundColor: "var(--bg-card)",
          }}
        >
          <div
            className="lit-header -mx-6 -mt-6 mb-4"
            style={{ color: "white" }}
          >
            🛡️ Privacy Policy
          </div>
          <p className="text-[10px] opacity-60 uppercase tracking-widest">
            Last Updated: June 5, 2026 · Your Data is Protected
          </p>
        </div>

        <div className="space-y-8 text-xs leading-relaxed opacity-90">
          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              1. Information We Collect
            </h2>
            <p className="mb-2">
              We collect several different types of information for various
              purposes to provide and improve our Platform:
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                <strong>Personal Data:</strong> Email address, username, profile
                information provided during registration via Clerk
                authentication.
              </li>
              <li>
                <strong>Usage Data:</strong> Browser type, browser version,
                pages visited, time spent on pages, unique device identifiers,
                and other diagnostic data.
              </li>
              <li>
                <strong>Local Storage:</strong> Theme preferences, LiTBit Coins
                balance, profile settings, and visitor counts stored locally in
                your browser.
              </li>
              <li>
                <strong>Agent Interactions:</strong> Messages sent to AI agents
                via our API are processed through Google Gemini. We do not
                permanently store chat logs unless explicitly saved by the user.
              </li>
            </ul>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              2. How We Use Your Information
            </h2>
            <p className="mb-2">
              LiTTree LabStudios uses the collected data for:
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>Providing and maintaining the Platform functionality.</li>
              <li>Authenticating users and securing accounts via Clerk.</li>
              <li>
                Processing marketplace transactions and LiTBit Coins economy.
              </li>
              <li>Analyzing usage patterns to improve the Platform.</li>
              <li>
                Communicating updates, security alerts, and promotional
                materials.
              </li>
            </ul>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              3. Data Storage & Security
            </h2>
            <p>
              We use industry-standard security measures including encryption in
              transit (TLS/SSL) and secure authentication providers. Your data
              is stored via Supabase and Clerk, both of which maintain SOC 2
              compliance. However, no method of transmission over the Internet
              is 100% secure.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              4. Third-Party Services
            </h2>
            <p className="mb-2">We use the following third-party services:</p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                <strong>Clerk:</strong> Authentication and user management.
                Clerk Privacy Policy applies.
              </li>
              <li>
                <strong>Supabase:</strong> Database and storage for agent
                listings and user data.
              </li>
              <li>
                <strong>Google Gemini API:</strong> Processes AI agent
                conversations. Data is handled per Google&apos;s Privacy Policy.
              </li>
              <li>
                <strong>Stripe:</strong> Payment processing for marketplace
                transactions.
              </li>
              <li>
                <strong>Vercel:</strong> Hosting and analytics infrastructure.
              </li>
            </ul>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              5. Cookies & Tracking
            </h2>
            <p>
              We use cookies and similar tracking technologies to track activity
              on our Platform and hold certain information. You can instruct
              your browser to refuse all cookies or to indicate when a cookie is
              being sent. Our cookie consent banner allows granular control over
              optional tracking.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              6. Your Data Rights
            </h2>
            <p className="mb-2">
              Depending on your location, you may have the right to:
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction or deletion of your personal data.</li>
              <li>Object to or restrict processing of your data.</li>
              <li>Export your data in a portable format.</li>
            </ul>
            <p className="mt-2">
              To exercise these rights, contact us at support@litlabs.net.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              7. Children&apos;s Privacy
            </h2>
            <p>
              Our Platform does not address anyone under the age of 13. We do
              not knowingly collect personally identifiable information from
              children under 13. If you are a parent or guardian and you are
              aware that your child has provided us with personal data, please
              contact us.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              8. Changes to This Policy
            </h2>
            <p>
              We may update our Privacy Policy from time to time. We will notify
              you of any changes by posting the new Privacy Policy on this page
              and updating the &quot;Last Updated&quot; date.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              9. Contact Us
            </h2>
            <p>
              If you have any questions about this Privacy Policy, please
              contact us at support@litlabs.net.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
