import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description: "Privacy Policy for LiTTree LabStudios AI creative operating system and social creator platform.",
  path: "/privacy",
  index: true,
});

export default function PrivacyPage() {
  return (
    <div
      className="min-h-screen pb-20 font-mono text-xs"
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
            Last Updated: August 10, 2026
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
                <strong>Account Data:</strong> Email address, username, and
                profile information provided during registration via Clerk
                authentication.
              </li>
              <li>
                <strong>Usage Data:</strong> Browser type, browser version,
                pages visited, time spent on pages, and device identifiers
                collected through standard web protocols.
              </li>
              <li>
                <strong>Local Storage:</strong> Theme preferences, UI state,
                and cached session metadata stored locally in your browser.
                AI credit balances are <strong>not</strong> stored in local
                storage — they are stored server-side in our Supabase credit
                ledger.
              </li>
              <li>
                <strong>Conversations &amp; Project Memory:</strong> Messages
                sent to AI agents, conversation history, project context, and
                agent memories are <strong>durably stored</strong> in our
                Supabase database. Conversations are linked to your account and
                projects, and persist across sessions.
              </li>
              <li>
                <strong>AI Credit Ledger:</strong> Your AI credit balance,
                transaction history (grants, spending, purchases), and billing
                records are stored server-side in our Supabase credit ledger.
              </li>
              <li>
                <strong>Uploaded Media &amp; Attachments:</strong> Files,
                images, audio, and other media you upload or generate are
                stored in Cloudflare R2 object storage and linked to your
                account.
              </li>
              <li>
                <strong>Voice Data:</strong> When you use voice features in
                Studio, your microphone audio is streamed to Inworld AI for
                speech-to-text transcription. The transcribed text is processed
                through the canonical Studio conversation. Generated responses
                may be sent to Inworld&apos;s dedicated TTS service for audio
                playback.
              </li>
              <li>
                <strong>Camera &amp; Screen Sharing:</strong> When you use
                camera preview or screen sharing features in Studio, camera
                output and screen content are processed locally in your browser
                and may be shared within your active session. These features
                require explicit browser permission prompts.
              </li>
              <li>
                <strong>GitHub Connection Data:</strong> When you connect a
                GitHub repository, we store repository references, branch
                information, and deployment metadata to enable project
                synchronization and terminal workspace provisioning.
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
                Processing subscriptions, AI credit grants, and marketplace
                transactions via Stripe.
              </li>
              <li>
                Routing AI requests to appropriate model providers based on
                task type, model availability, and user configuration.
              </li>
              <li>
                Storing conversation history, project memory, and agent context
                to provide continuity across sessions.
              </li>
              <li>
                Provisioning terminal workspaces and synchronizing GitHub
                repositories.
              </li>
              <li>Analyzing usage patterns to improve the Platform.</li>
              <li>
                Communicating updates, security alerts, and service
                notifications.
              </li>
            </ul>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              3. AI Model Provider Routing
            </h2>
            <p className="mb-2">
              Your AI conversations and generation requests are processed
              through multiple model providers depending on the task type,
              model availability, and your configuration. Providers include:
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                <strong>Google Gemini:</strong> Primary LLM and image
                generation (free tier).
              </li>
              <li>
                <strong>OpenRouter:</strong> Fallback LLM routing with
                multiple models (DeepSeek, Mistral, Llama, Qwen, Trinity).
              </li>
              <li>
                <strong>Groq:</strong> Fast inference and audio transcription
                (Whisper).
              </li>
              <li>
                <strong>OpenAI:</strong> Premium LLM and media generation
                (BYOK — Bring Your Own Key).
              </li>
              <li>
                <strong>Anthropic:</strong> Premium LLM (BYOK).
              </li>
              <li>
                <strong>Together:</strong> FLUX image generation.
              </li>
              <li>
                <strong>Fal:</strong> Image generation.
              </li>
              <li>
                <strong>MiniMax:</strong> 3D generation (Space model).
              </li>
              <li>
                <strong>Alibaba:</strong> Image and video generation.
              </li>
              <li>
                <strong>Recraft:</strong> Vector and logo image generation.
              </li>
              <li>
                <strong>Cloudflare:</strong> Image generation.
              </li>
              <li>
                <strong>ElevenLabs:</strong> Music and audio generation.
              </li>
              <li>
                <strong>Inworld AI:</strong> Voice speech-to-text and
                text-to-speech.
              </li>
            </ul>
            <p className="mt-2">
              Each provider processes data according to its own privacy policy.
              Your conversation content and generation requests are transmitted
              to these providers via encrypted connections. We do not expose
              API credentials to the browser.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              4. Data Storage &amp; Security
            </h2>
            <p className="mb-2">
              We use industry-standard security measures including encryption
              in transit (TLS/SSL) and secure authentication. Your data is
              stored as follows:
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                <strong>Authentication data:</strong> Managed by Clerk (SOC 2
                compliant).
              </li>
              <li>
                <strong>Database:</strong> Supabase (PostgreSQL) stores user
                accounts, conversations, project memory, AI credit
                ledger, subscriptions, and marketplace data.
              </li>
              <li>
                <strong>File storage:</strong> Cloudflare R2 stores uploaded
                and generated media (images, audio, video, assets).
              </li>
              <li>
                <strong>Payment data:</strong> Processed by Stripe. We do not
                store full card numbers — Stripe handles PCI-compliant payment
                data.
              </li>
              <li>
                <strong>Code &amp; terminal workspaces:</strong> Provisioned on
                Railway infrastructure with per-user isolation.
              </li>
            </ul>
            <p className="mt-2">
              No method of transmission over the Internet is 100% secure. While
              we strive to protect your data, we cannot guarantee absolute
              security.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              5. Third-Party Services
            </h2>
            <p className="mb-2">We use the following third-party services:</p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                <strong>Clerk:</strong> Authentication and user management.
              </li>
              <li>
                <strong>Supabase:</strong> Database, conversations, project
                memory, and AI credit ledger.
              </li>
              <li>
                <strong>Stripe:</strong> Payment processing for subscriptions
                and marketplace transactions.
              </li>
              <li>
                <strong>Cloudflare R2:</strong> Object storage for media and
                assets.
              </li>
              <li>
                <strong>Vercel:</strong> Hosting and deployment infrastructure.
              </li>
              <li>
                <strong>Railway:</strong> Terminal workspace provisioning and
                voice proxy.
              </li>
              <li>
                <strong>GitHub:</strong> Repository connections for project
                synchronization.
              </li>
              <li>
                <strong>Inworld AI:</strong> Voice speech-to-text and
                text-to-speech.
              </li>
              <li>
                <strong>AI Model Providers:</strong> Google Gemini, OpenRouter,
                Groq, OpenAI, Anthropic, Together, Fal, MiniMax, Alibaba,
                Recraft, Cloudflare, ElevenLabs — as described in Section 3.
              </li>
            </ul>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              6. Cookies &amp; Local Storage
            </h2>
            <p className="mb-2">
              We use minimal cookies and browser storage:
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                <strong>Authentication cookies:</strong> Set by Clerk to
                maintain your signed-in session.
              </li>
              <li>
                <strong>Local storage:</strong> Theme preferences, UI state,
                and cached session metadata. AI credit balances are fetched from
                the server, not stored locally.
              </li>
              <li>
                <strong>Analytics:</strong> Vercel Analytics may collect basic
                usage metrics (page views, performance). No cross-site
                tracking or advertising cookies are used.
              </li>
            </ul>
            <p className="mt-2">
              You can instruct your browser to refuse all cookies. Note that
              this may affect Platform functionality, particularly
              authentication.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              7. Data Retention
            </h2>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                <strong>Conversations &amp; project memory:</strong> Retained
                for the lifetime of your account unless you delete them.
              </li>
              <li>
                <strong>AI credit ledger:</strong> Transaction history is
                retained for billing and audit purposes.
              </li>
              <li>
                <strong>Uploaded media:</strong> Retained until you delete the
                associated project or asset.
              </li>
              <li>
                <strong>Voice data:</strong> Audio streams are processed in
                real-time by Inworld AI for transcription and TTS. We do not
                store raw audio recordings unless explicitly saved as part of a
                project.
              </li>
              <li>
                <strong>Audit events:</strong> Security and operational audit
                logs are retained for <strong>90 days</strong>, then
                automatically purged. IP addresses and user agents are only
                recorded for security-critical events (errors, rate limiting,
                denied approvals, deployments) — routine events do not capture
                IP or device information.
              </li>
              <li>
                <strong>Rate limit data:</strong> IP-based rate limit counters
                are purged after <strong>1 hour</strong>. These are used solely
                for abuse prevention and do not constitute a tracking record.
              </li>
              <li>
                <strong>Account data:</strong> Retained while your account is
                active. You may request deletion at any time.
              </li>
            </ul>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              8. Your Data Rights
            </h2>
            <p className="mb-2">
              Depending on your location, you may have the right to:
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction or deletion of your personal data.</li>
              <li>Object to or restrict processing of your data.</li>
              <li>Export your data in a portable format.</li>
              <li>Disconnect GitHub repositories and revoke access.</li>
              <li>Delete conversations and project memory.</li>
            </ul>
            <p className="mt-2">
              To exercise these rights, contact us at support@litlabs.net.
              We will respond to your request <strong>within 30 days</strong>,
              as required by GDPR Article 12. For complex requests, we may extend
              this by up to 60 additional days and will inform you of the extension
              within the first 30 days.
            </p>
            <p className="mt-2">
              You can also export your data directly from{" "}
              <a href="/settings" className="underline font-semibold" style={{ color: "var(--link-color)" }}>Settings → Privacy &amp; Security</a>{" "}
              without contacting us, or delete your data via the same page.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              9. Data Subject Access Requests (DSAR)
            </h2>
            <p className="mb-2">
              If you wish to access, correct, export, or delete your personal data,
              you can:
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                <strong>Self-service:</strong> Use the Export and Delete buttons in{" "}
                <a href="/settings" className="underline font-semibold" style={{ color: "var(--link-color)" }}>Settings → Privacy &amp; Security</a>.{" "}
                These actions take effect immediately on our database.
              </li>
              <li>
                <strong>Email request:</strong> Email support@litlabs.net with the
                subject line &ldquo;Data Request&rdquo;. Include your account email so we
                can verify your identity.
              </li>
            </ul>
            <p className="mt-2">
              We will verify your identity before processing any request. We
              respond to all valid requests <strong>within 30 days</strong>.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              10. Data Breach Response
            </h2>
            <p className="mb-2">
              In the event of a personal data breach, we will:
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                Assess the breach within <strong>24 hours</strong> of discovery to
                determine its scope and severity.
              </li>
              <li>
                Notify the relevant supervisory authority within
                <strong> 72 hours</strong> of becoming aware of the breach, as
                required by GDPR Article 33.
              </li>
              <li>
                Notify affected users without undue delay if the breach is likely
                to result in a high risk to their rights and freedoms (GDPR
                Article 34).
              </li>
              <li>
                Document the breach, its effects, and the remedial action taken.
              </li>
            </ul>
            <p className="mt-2">
              To report a suspected breach, email support@litlabs.net immediately.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              11. User Controls
            </h2>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>
                <strong>Voice:</strong> Microphone access requires explicit
                browser permission and can be revoked at any time in your
                browser settings.
              </li>
              <li>
                <strong>Camera:</strong> Camera preview requires explicit
                browser permission and is only active when you open the camera
                tool in Studio.
              </li>
              <li>
                <strong>Screen sharing:</strong> Screen share requires explicit
                browser permission and is only active during an active share
                session.
              </li>
              <li>
                <strong>GitHub:</strong> You can disconnect repositories at any
                time from your Studio settings.
              </li>
              <li>
                <strong>AI providers (BYOK):</strong> When you provide your own
                API keys (OpenAI, Anthropic), those keys are stored encrypted
                and used only for your requests.
              </li>
            </ul>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              12. Children&apos;s Privacy
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
              13. Security Limitations
            </h2>
            <p>
              While we use industry-standard security practices, no platform is
              perfectly secure. AI model providers may retain conversation data
              according to their own policies. We recommend not sharing
              sensitive personal information, trade secrets, or credentials in
              AI conversations.
            </p>
          </section>

          <section>
            <h2
              className="text-sm font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--header-color)" }}
            >
              14. Changes to This Policy
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
              15. Contact Us
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
