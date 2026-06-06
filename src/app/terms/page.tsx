import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | LiTTree Lab Studios",
  description: "Terms of Service for LiTTree Lab Studios AI Agent Platform.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen pb-20" style={{ backgroundColor: "#0a0a0f", color: "#00ff41", fontFamily: "monospace" }}>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="border-2 p-6 mb-8" style={{ borderColor: "#ff00ff", backgroundColor: "#1a0a2e" }}>
          <h1 className="text-xl font-bold tracking-widest uppercase mb-2" style={{ color: "#00ffff" }}>
            ⚖️ Terms of Service
          </h1>
          <p className="text-[10px] opacity-60 uppercase tracking-widest">
            Last Updated: June 5, 2026 · Effective Immediately
          </p>
        </div>

        <div className="space-y-8 text-xs leading-relaxed opacity-90">
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>1. Acceptance of Terms</h2>
            <p>
              By accessing or using LiTTree Lab Studios ("Platform"), you agree to be bound by these Terms of Service. If you do not agree to all terms, you may not access the Platform. These terms apply to all visitors, users, and others who access or use the service.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>2. AI Agents Disclaimer</h2>
            <p className="mb-2">
              AI Agents on this Platform are user-submitted tools. LiTTree Lab Studios does not verify the functionality, accuracy, or safety of every agent.
            </p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>Agents may not provide accurate, complete, or up-to-date information.</li>
              <li>Agents are prohibited from providing medical, legal, or financial advice without clear disclosure that they are not licensed professionals.</li>
              <li>Users assume all risk from using any agent output.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>3. User Accounts</h2>
            <p>
              You are responsible for safeguarding the password and authentication credentials used to access the Platform. You agree not to disclose your password to any third party. You must notify us immediately upon becoming aware of any breach of security or unauthorized use of your account.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>4. Intellectual Property</h2>
            <p>
              The Platform and its original content (excluding content provided by users and AI agents), features, and functionality are and will remain the exclusive property of LiTTree Lab Studios. This includes all software, design, logos, and branding.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>5. Prohibited Uses</h2>
            <p className="mb-2">You may not use the Platform to:</p>
            <ul className="list-disc pl-5 space-y-1 opacity-80">
              <li>Violate any applicable law or regulation.</li>
              <li>Infringe upon or violate the intellectual property rights of others.</li>
              <li>Upload or distribute malicious software, viruses, or harmful code.</li>
              <li>Harass, abuse, insult, harm, or discriminate against any person or group.</li>
              <li>Engage in unauthorized data mining, scraping, or harvesting.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>6. Termination</h2>
            <p>
              We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms. Upon termination, your right to use the Platform will immediately cease.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>7. Limitation of Liability</h2>
            <p>
              In no event shall LiTTree Lab Studios be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>8. Governing Law</h2>
            <p>
              These Terms shall be governed and construed in accordance with the laws of the jurisdiction in which LiTTree Lab Studios operates, without regard to its conflict of law provisions.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>9. Changes to Terms</h2>
            <p>
              We reserve the right, at our sole discretion, to modify or replace these Terms at any time. What constitutes a material change will be determined at our sole discretion. By continuing to access or use our Platform after those revisions become effective, you agree to be bound by the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>10. Contact</h2>
            <p>
              If you have any questions about these Terms, please contact us through the Platform or at support@litlabs.net.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
