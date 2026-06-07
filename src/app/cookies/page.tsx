import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy | LiTreeLabStudios",
  description: "Cookie Policy for LiTreeLabStudios AI Agent Platform.",
};

export default function CookiesPage() {
  return (
    <div className="min-h-screen pb-20 font-mono text-xs" style={{ backgroundColor: "var(--bg-color)", color: "var(--text-color)" }}>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="lit-box p-6 mb-8" style={{ borderColor: "var(--border-color)", backgroundColor: "var(--bg-card)" }}>
          <div className="lit-header -mx-6 -mt-6 mb-4" style={{ color: "white" }}>🍪 Cookie Policy</div>
          <p className="text-[10px] opacity-60 uppercase tracking-widest">
            Last Updated: June 5, 2026 · Transparency First
          </p>
        </div>

        <div className="space-y-8 text-xs leading-relaxed opacity-90">
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "var(--header-color)" }}>What Are Cookies?</h2>
            <p>
              Cookies are small text files placed on your device to store data that can be recalled by a web server. We use cookies and similar technologies to improve your browsing experience, analyze site traffic, and understand where our visitors come from.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "var(--header-color)" }}>How We Use Cookies</h2>
            <div className="space-y-4">
              <div className="border p-3" style={{ borderColor: "var(--border-color)" }}>
                <h3 className="font-bold text-xs mb-1" style={{ color: "var(--link-color)" }}>🔒 Essential Cookies</h3>
                <p className="opacity-80">
                  These cookies are necessary for the Platform to function. They enable core functionality such as authentication (Clerk session), security, and network management. You cannot opt out of these.
                </p>
              </div>

              <div className="border p-3" style={{ borderColor: "var(--border-color)" }}>
                <h3 className="font-bold text-xs mb-1" style={{ color: "var(--link-color)" }}>⚙️ Preference Cookies</h3>
                <p className="opacity-80">
                  These cookies remember your settings and choices, such as theme preferences (dark/light mode), skin presets, CRT filter settings, and profile customizations. They enhance your experience by personalizing the interface.
                </p>
              </div>

              <div className="border p-3" style={{ borderColor: "var(--border-color)" }}>
                <h3 className="font-bold text-xs mb-1" style={{ color: "var(--link-color)" }}>📊 Analytics Cookies</h3>
                <p className="opacity-80">
                  These cookies help us understand how visitors interact with the Platform by collecting and reporting information anonymously. We use Vercel Analytics, which does not use cookies but collects basic usage metrics.
                </p>
              </div>

              <div className="border p-3" style={{ borderColor: "var(--border-color)" }}>
                <h3 className="font-bold text-xs mb-1" style={{ color: "var(--link-color)" }}>💰 Marketing & Commerce Cookies</h3>
                <p className="opacity-80">
                  These cookies track your activity on the Platform to deliver relevant marketplace recommendations and measure the effectiveness of promotional campaigns. Currently minimal usage.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "var(--header-color)" }}>Local Storage</h2>
            <p>
              In addition to cookies, we use browser localStorage to persist user preferences (themes, profiles, LiTBit Coins balances, visitor counts). This data never leaves your device and is not transmitted to our servers unless explicitly synced.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "var(--header-color)" }}>Managing Cookies</h2>
            <p className="mb-2">
              You can control and/or delete cookies as you wish. You can delete all cookies that are already on your computer and you can set most browsers to prevent them from being placed. However, if you do this, you may have to manually adjust some preferences every time you visit the Platform, and some services and functionalities may not work.
            </p>
            <p className="opacity-80">
              Most browsers allow you to refuse to accept cookies and to delete cookies. The methods for doing so vary from browser to browser. Please consult your browser&apos;s help documentation for more information.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "var(--header-color)" }}>Third-Party Cookies</h2>
            <p>
              Some of our pages display content from external providers (e.g., Spotify embeds, Unsplash images). These providers may set their own cookies. We do not control these cookies. Please refer to the respective privacy policies of these third parties for more information.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "var(--header-color)" }}>Contact</h2>
            <p>
              If you have any questions about our Cookie Policy, please contact us at support@litlabs.net.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
