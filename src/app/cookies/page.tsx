import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy | LiTTree Lab Studios",
  description: "Cookie Policy for LiTTree Lab Studios AI Agent Platform.",
};

export default function CookiesPage() {
  return (
    <div className="min-h-screen pb-20" style={{ backgroundColor: "#0a0a0f", color: "#00ff41", fontFamily: "monospace" }}>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="border-2 p-6 mb-8" style={{ borderColor: "#ff00ff", backgroundColor: "#1a0a2e" }}>
          <h1 className="text-xl font-bold tracking-widest uppercase mb-2" style={{ color: "#00ffff" }}>
            🍪 Cookie Policy
          </h1>
          <p className="text-[10px] opacity-60 uppercase tracking-widest">
            Last Updated: June 5, 2026 · Transparency First
          </p>
        </div>

        <div className="space-y-8 text-xs leading-relaxed opacity-90">
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>What Are Cookies?</h2>
            <p>
              Cookies are small text files placed on your device to store data that can be recalled by a web server. We use cookies and similar technologies to improve your browsing experience, analyze site traffic, and understand where our visitors come from.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>How We Use Cookies</h2>
            <div className="space-y-4">
              <div className="border p-3" style={{ borderColor: "#ff00ff" }}>
                <h3 className="font-bold text-xs mb-1" style={{ color: "#00ffff" }}>🔒 Essential Cookies</h3>
                <p className="opacity-80">
                  These cookies are necessary for the Platform to function. They enable core functionality such as authentication (Clerk session), security, and network management. You cannot opt out of these.
                </p>
              </div>

              <div className="border p-3" style={{ borderColor: "#ff00ff" }}>
                <h3 className="font-bold text-xs mb-1" style={{ color: "#00ffff" }}>⚙️ Preference Cookies</h3>
                <p className="opacity-80">
                  These cookies remember your settings and choices, such as theme preferences (dark/light mode), skin presets, CRT filter settings, and profile customizations. They enhance your experience by personalizing the interface.
                </p>
              </div>

              <div className="border p-3" style={{ borderColor: "#ff00ff" }}>
                <h3 className="font-bold text-xs mb-1" style={{ color: "#00ffff" }}>📊 Analytics Cookies</h3>
                <p className="opacity-80">
                  These cookies help us understand how visitors interact with the Platform by collecting and reporting information anonymously. We use Vercel Analytics, which does not use cookies but collects basic usage metrics.
                </p>
              </div>

              <div className="border p-3" style={{ borderColor: "#ff00ff" }}>
                <h3 className="font-bold text-xs mb-1" style={{ color: "#00ffff" }}>💰 Marketing & Commerce Cookies</h3>
                <p className="opacity-80">
                  These cookies track your activity on the Platform to deliver relevant marketplace recommendations and measure the effectiveness of promotional campaigns. Currently minimal usage.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>Local Storage</h2>
            <p>
              In addition to cookies, we use browser localStorage to persist user preferences (themes, profiles, LitCoins balances, visitor counts). This data never leaves your device and is not transmitted to our servers unless explicitly synced.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>Managing Cookies</h2>
            <p className="mb-2">
              You can control and/or delete cookies as you wish. You can delete all cookies that are already on your computer and you can set most browsers to prevent them from being placed. However, if you do this, you may have to manually adjust some preferences every time you visit the Platform, and some services and functionalities may not work.
            </p>
            <p className="opacity-80">
              Most browsers allow you to refuse to accept cookies and to delete cookies. The methods for doing so vary from browser to browser. Please consult your browser&apos;s help documentation for more information.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>Third-Party Cookies</h2>
            <p>
              Some of our pages display content from external providers (e.g., Spotify embeds, Unsplash images). These providers may set their own cookies. We do not control these cookies. Please refer to the respective privacy policies of these third parties for more information.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: "#ff0080" }}>Contact</h2>
            <p>
              If you have any questions about our Cookie Policy, please contact us at support@litlabs.net.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
