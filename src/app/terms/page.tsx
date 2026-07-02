import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12" style={{ color: "var(--text-color)" }}>
      <h1 className="text-3xl font-bold mb-6" style={{ color: "var(--header-color)" }}>Terms of Service</h1>
      <div className="space-y-4 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
        <p>Welcome to LiTTree Lab Studios. By using our platform, you agree to these terms.</p>
        <h2 className="text-lg font-semibold" style={{ color: "var(--header-color)" }}>1. Use of Service</h2>
        <p>You must be 13 or older to use this platform. You are responsible for all activity under your account.</p>
        <h2 className="text-lg font-semibold" style={{ color: "var(--header-color)" }}>2. AI-Generated Content</h2>
        <p>Content created by AI agents on your behalf is your responsibility. You retain ownership of your original content.</p>
        <h2 className="text-lg font-semibold" style={{ color: "var(--header-color)" }}>3. Limitation of Liability</h2>
        <p>LiTTree Lab Studios is provided &ldquo;as is&rdquo; without warranties. We are not liable for damages arising from use of the platform.</p>
        <p className="pt-4">
          <Link href="/" className="underline hover:no-underline" style={{ color: "var(--link-color)" }}>Back to Home</Link>
        </p>
      </div>
    </div>
  );
}
