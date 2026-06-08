"use client";

import { useState, useEffect } from "react";
import { useTheme, darkSkins, lightSkins, type SkinPreset, type AccentColor } from "@/context/ThemeContext";
import type { BackgroundMode } from "@/components/AnimatedBackground";
import { useProfile, type UserProfile } from "@/context/ProfileContext";
import { useAuth, RedirectToSignIn } from "@clerk/nextjs";
import PageShell from "@/components/PageShell";

export default function SettingsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { theme, resolvedColors, setMode, setSkin, setAccent, setBackgroundMode, resetTheme } = useTheme();
  const { profile, updateProfile, resetProfile } = useProfile();

  const [activeTab, setActiveTab] = useState<"theme" | "profile" | "agents" | "advanced" | "interface">("theme");
  const [saved, setSaved] = useState(false);
  const [crtEnabled, setCrtEnabled] = useState(false);

  // Interface settings
  const [animSpeed, setAnimSpeed] = useState<string>("normal");
  const [compactMode, setCompactMode] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundEffects, setSoundEffects] = useState(false);
  const [customCSS, setCustomCSS] = useState("");

  const skinPresets: SkinPreset[] = ["cyberpunk", "retro", "ocean", "sunset", "matrix", "pink", "synthwave", "volcanic", "gold", "arctic", "emerald", "midnight", "neon", "blood", "cosmic", "miami"];
  const backgroundModes: { mode: BackgroundMode; label: string }[] = [
    { mode: "constellation", label: "Constellation" },
    { mode: "nebula", label: "Nebula" },
    { mode: "waves", label: "Waves" },
    { mode: "minimal", label: "Minimal" },
  ];
  const accentColors: AccentColor[] = ["neon-green", "hot-pink", "electric-blue", "cyber-yellow", "matrix-green", "sunset-orange", "ocean-blue", "purple-haze"];

  useEffect(() => {
    // Check local storage for persistent CRT configuration
    const val = localStorage.getItem("crt_global_scanlines");
    if (val !== null) {
      setCrtEnabled(val === "true");
    }
    // Load interface settings
    setAnimSpeed(localStorage.getItem("litlabs-anim-speed") || "normal");
    setCompactMode(localStorage.getItem("litlabs-compact") === "true");
    setReducedMotion(localStorage.getItem("litlabs-reduced-motion") === "true");
    setSoundEffects(localStorage.getItem("litlabs-sound") === "true");
    setCustomCSS(localStorage.getItem("litlabs-custom-css") || "");
  }, []);

  // Require authentication (after all hooks to respect Rules of Hooks)
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono" style={{ backgroundColor: "#0a0a0f", color: "#00ff41" }}>
        <div className="text-center">
          <div className="text-3xl mb-4">⏳</div>
          <div>Loading settings...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <RedirectToSignIn redirectUrl="/settings" />;
  }

  const toggleCrtGlobally = () => {
    const next = !crtEnabled;
    setCrtEnabled(next);
    localStorage.setItem("crt_global_scanlines", String(next));
    // Trigger storage event to notify other tabs
    window.dispatchEvent(new Event("storage"));
    showSaved();
  };

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const saveInterface = (key: string, value: string | boolean) => {
    localStorage.setItem(`litlabs-${key}`, String(value));
    showSaved();
    // Apply reduced motion immediately
    if (key === "reduced-motion") {
      document.documentElement.style.setProperty("--anim-duration-multiplier", value ? "0" : "1");
    }
    if (key === "custom-css") {
      let style = document.getElementById("litlabs-custom-css") as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement("style");
        style.id = "litlabs-custom-css";
        document.head.appendChild(style);
      }
      style.textContent = value as string;
    }
  };

  const T = resolvedColors;

  return (
    <PageShell title="Settings" className="font-mono text-xs relative">
      
      {/* Local CRT Filter */}
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-40 opacity-[0.06]" style={{
          background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 2px)",
          boxShadow: "inset 0 0 80px rgba(0, 255, 0, 0.3)"
        }} />
      )}

      {/* Status Ticker */}
      <div className="w-full bg-black py-1 border-b-2 overflow-hidden flex" style={{ borderColor: T.borderColor, color: T.accentColor }}>
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>SYSTEM CONFIGURATION // LiTTree Lab Studios Platform v2.0</span>
          <span>THEME ENGINE ACTIVE // 16 SKIN PRESETS REGISTERED</span>
          <span>SESSION SECURED // AUTHENTICATION VERIFIED</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        
        {/* Title Header */}
        <div className="border-2 p-4 bg-black/60 mb-6 flex justify-between items-center shadow-lg" style={{ borderColor: T.borderColor }}>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-widest uppercase" style={{ color: T.headerColor }}>Platform Settings</h1>
          </div>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Configuration</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-6 flex-wrap">
          {(["theme", "profile", "agents", "interface", "advanced"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 text-xs font-bold border-2 capitalize transition-all active:scale-95"
              style={{
                borderColor: activeTab === tab ? T.accentColor : T.borderColor,
                backgroundColor: activeTab === tab ? `${T.accentColor}18` : "transparent",
                color: activeTab === tab ? T.accentColor : T.textColor,
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Theme Tab */}
        {activeTab === "theme" && (
          <div className="space-y-6 animate-fadeIn">
            
            {/* Global Monitor Setting */}
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Background Effect</div>
              <p className="text-[11px] mb-3 opacity-80 leading-normal">
                Choose a live animated background style for the workspace.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {backgroundModes.map((bm) => (
                  <button
                    key={bm.mode}
                    onClick={() => { setBackgroundMode(bm.mode); showSaved(); }}
                    className="p-2 border-2 text-center text-xs font-bold capitalize transition-all hover:scale-105"
                    style={{
                      borderColor: theme.backgroundMode === bm.mode ? T.accentColor : T.borderColor,
                      backgroundColor: theme.backgroundMode === bm.mode ? `${T.accentColor}18` : "transparent",
                      color: T.textColor,
                    }}
                  >
                    {bm.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Display Options</div>
              <p className="text-[11px] mb-3 opacity-80 leading-normal">
                Toggle the CRT scanline overlay effect.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={toggleCrtGlobally}
                  className="px-4 py-2 border-2 font-bold text-xs hover:scale-105 transition-transform"
                  style={{
                    borderColor: T.borderColor,
                    backgroundColor: crtEnabled ? T.linkColor : "transparent",
                    color: crtEnabled ? "black" : T.textColor
                  }}
                >
                  CRT Overlay: {crtEnabled ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            {/* Dark / Light */}
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Terminal Mode</div>
              <p className="text-[11px] mb-3 opacity-80">Toggle the primary luminance factor.</p>
              <div className="flex gap-3">
                <button onClick={() => { setMode("dark"); showSaved(); }} className="px-4 py-2 border-2 font-bold text-xs hover:scale-105 transition-transform" style={{ borderColor: T.borderColor, backgroundColor: theme.mode === "dark" ? T.linkColor : "transparent", color: theme.mode === "dark" ? "black" : T.textColor }}>Dark Mode</button>
                <button onClick={() => { setMode("light"); showSaved(); }} className="px-4 py-2 border-2 font-bold text-xs hover:scale-105 transition-transform" style={{ borderColor: T.borderColor, backgroundColor: theme.mode === "light" ? T.linkColor : "transparent", color: theme.mode === "light" ? "black" : T.textColor }}>Light Mode</button>
              </div>
            </div>

            {/* Skin Presets */}
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Skin Override Presets</div>
              <p className="text-[11px] mb-3 opacity-80">Inject a preconfigured CSS palette variable mapping.</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {skinPresets.map((skin) => (
                  <button
                    key={skin}
                    onClick={() => { setSkin(skin); showSaved(); }}
                    className="p-2.5 border-2 text-center text-xs font-bold capitalize transition-all hover:scale-105"
                    style={{
                      borderColor: theme.skin === skin ? T.accentColor : T.borderColor,
                      backgroundColor: theme.skin === skin ? `${T.accentColor}18` : "transparent",
                      color: T.textColor,
                    }}
                  >
                    {skin}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent Colors */}
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Neon Accent Color</div>
              <p className="text-[11px] mb-3 opacity-80">Adjust secondary neon phosphor highlights.</p>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {accentColors.map((accent) => (
                  <button
                    key={accent}
                    onClick={() => { setAccent(accent); showSaved(); }}
                    className="p-2 border-2 text-center text-[10px] font-bold capitalize transition-all hover:scale-105 whitespace-nowrap overflow-hidden text-ellipsis"
                    style={{
                      borderColor: theme.accent === accent ? T.accentColor : T.borderColor,
                      backgroundColor: theme.accent === accent ? `${T.accentColor}18` : "transparent",
                      color: T.textColor,
                    }}
                  >
                    {accent.replace("-", " ")}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={() => { resetTheme(); showSaved(); }} className="px-4 py-2 text-xs font-bold border-2 transition-transform active:scale-95" style={{ borderColor: T.borderColor, color: T.textColor }}>↺ Reset Theme Defaults</button>
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className="space-y-4 animate-fadeIn">
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Display Name</div>
              <input
                type="text"
                value={profile.displayName}
                onChange={(e) => { updateProfile({ displayName: e.target.value }); showSaved(); }}
                className="w-full p-2 border-2 bg-transparent text-xs font-mono outline-none"
                style={{ borderColor: T.borderColor, color: T.textColor }}
              />
            </div>
            
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Bio & Mission Parameters</div>
              <textarea
                value={profile.bio}
                onChange={(e) => { updateProfile({ bio: e.target.value }); showSaved(); }}
                rows={3}
                className="w-full p-2 border-2 bg-transparent text-xs font-mono outline-none resize-none"
                style={{ borderColor: T.borderColor, color: T.textColor }}
              />
            </div>

            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Active Custom Mood</div>
              <input
                type="text"
                value={profile.mood}
                onChange={(e) => { updateProfile({ mood: e.target.value }); showSaved(); }}
                className="w-full p-2 border-2 bg-transparent text-xs font-mono outline-none"
                style={{ borderColor: T.borderColor, color: T.textColor }}
              />
            </div>

            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Network Target URL</div>
              <input
                type="text"
                value={profile.website}
                onChange={(e) => { updateProfile({ website: e.target.value }); showSaved(); }}
                className="w-full p-2 border-2 bg-transparent text-xs font-mono outline-none"
                style={{ borderColor: T.borderColor, color: T.textColor }}
              />
            </div>

            <button onClick={() => { resetProfile(); showSaved(); }} className="px-4 py-2 text-xs font-bold border-2 transition-transform active:scale-95" style={{ borderColor: T.borderColor, color: T.textColor }}>↺ Reset Profile</button>
          </div>
        )}

        {/* Agents Tab */}
        {activeTab === "agents" && (
          <div className="space-y-4 animate-fadeIn">
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>ActivePieces Webhook</div>
              <p className="text-[11px] mb-2 opacity-80 leading-normal">Your multi-agent flow is fully linked. The Director plans, and specialists execute.</p>
              <code className="block p-3.5 text-[10px] border font-mono break-all" style={{ borderColor: T.borderColor, backgroundColor: T.bgColor, color: T.accentColor }}>
                https://cloud.activepieces.com/api/v1/webhooks/VoccE3SEr4bciLvkThTlO
              </code>
            </div>

            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Built-in Core Agents</div>
              <p className="text-[11px] mb-3 opacity-80">These core models are locked in active service arrays.</p>
              <div className="space-y-2 text-xs">
                {[
                  { name: "Director", role: "Orchestrator System", icon: "🎯" },
                  { name: "Champion", role: "General Assistant Core", icon: "🏆" },
                  { name: "Code Champion", role: "Expert Software Array", icon: "💻" },
                  { name: "Social Dominator", role: "Growth & Viral Hack Core", icon: "📱" },
                  { name: "Data Slayer", role: "Deep Analytical Array", icon: "📊" },
                  { name: "Writing Coach", role: "Refined Copy Core", icon: "✍️" },
                ].map((a) => (
                  <div key={a.name} className="flex items-center gap-3 p-2.5 border" style={{ borderColor: T.borderColor }}>
                    <span className="text-sm">{a.icon}</span>
                    <span className="font-bold text-gray-200">{a.name}</span>
                    <span className="text-[10px] opacity-60 ml-auto font-mono tracking-widest">{a.role.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Interface Tab */}
        {activeTab === "interface" && (
          <div className="space-y-4 animate-fadeIn">
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Animation Speed</div>
              <p className="text-[11px] mb-3 opacity-80">Control the pacing of page transitions and micro-interactions.</p>
              <div className="flex gap-2 flex-wrap">
                {["fast", "normal", "slow", "off"].map((speed) => (
                  <button
                    key={speed}
                    onClick={() => { setAnimSpeed(speed); saveInterface("anim-speed", speed); }}
                    className="px-4 py-2 border-2 font-bold text-xs hover:scale-105 transition-transform"
                    style={{
                      borderColor: animSpeed === speed ? T.accentColor : T.borderColor,
                      backgroundColor: animSpeed === speed ? `${T.accentColor}18` : "transparent",
                      color: animSpeed === speed ? T.accentColor : T.textColor,
                    }}
                  >
                    {speed.charAt(0).toUpperCase() + speed.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Display Density</div>
              <p className="text-[11px] mb-3 opacity-80">Toggle a tighter, more compact layout with reduced spacing.</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => { setCompactMode(true); saveInterface("compact", true); }}
                  className="px-4 py-2 border-2 font-bold text-xs hover:scale-105 transition-transform"
                  style={{ borderColor: compactMode ? T.accentColor : T.borderColor, backgroundColor: compactMode ? `${T.accentColor}18` : "transparent", color: compactMode ? T.accentColor : T.textColor }}
                >
                  Compact
                </button>
                <button
                  onClick={() => { setCompactMode(false); saveInterface("compact", false); }}
                  className="px-4 py-2 border-2 font-bold text-xs hover:scale-105 transition-transform"
                  style={{ borderColor: !compactMode ? T.accentColor : T.borderColor, backgroundColor: !compactMode ? `${T.accentColor}18` : "transparent", color: !compactMode ? T.accentColor : T.textColor }}
                >
                  Comfortable
                </button>
              </div>
            </div>

            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Accessibility</div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs">Reduced Motion</div>
                    <div className="text-[10px] opacity-70">Disable animated transitions and effects.</div>
                  </div>
                  <button
                    onClick={() => { const next = !reducedMotion; setReducedMotion(next); saveInterface("reduced-motion", next); }}
                    className="px-3 py-1.5 border-2 font-bold text-xs transition-transform"
                    style={{ borderColor: reducedMotion ? T.accentColor : T.borderColor, backgroundColor: reducedMotion ? T.accentColor : "transparent", color: reducedMotion ? "#0a0a0f" : T.textColor }}
                  >
                    {reducedMotion ? "ON" : "OFF"}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs">Sound Effects</div>
                    <div className="text-[10px] opacity-70">Play subtle UI audio cues (coming soon).</div>
                  </div>
                  <button
                    onClick={() => { const next = !soundEffects; setSoundEffects(next); saveInterface("sound", next); }}
                    className="px-3 py-1.5 border-2 font-bold text-xs transition-transform"
                    style={{ borderColor: soundEffects ? T.accentColor : T.borderColor, backgroundColor: soundEffects ? T.accentColor : "transparent", color: soundEffects ? "#0a0a0f" : T.textColor }}
                  >
                    {soundEffects ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
            </div>

            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3 flex justify-between items-center" style={{ color: "white" }}>
                <span>Custom CSS Injection</span>
                <button onClick={() => { setCustomCSS(""); saveInterface("custom-css", ""); }} className="text-[9px] px-2 py-0.5 border" style={{ borderColor: T.accentColor, color: T.accentColor }}>Clear</button>
              </div>
              <p className="text-[11px] mb-3 opacity-80">Inject your own CSS rules directly into the DOM. Use with caution.</p>
              <textarea
                value={customCSS}
                onChange={(e) => setCustomCSS(e.target.value)}
                onBlur={(e) => saveInterface("custom-css", e.target.value)}
                rows={6}
                placeholder={":root { --border-color: #ff00ff; }\n.my-class { color: red; }"}
                className="w-full p-2 border-2 bg-transparent text-[10px] font-mono outline-none resize-none"
                style={{ borderColor: T.borderColor, color: T.textColor }}
              />
            </div>
          </div>
        )}

        {/* Advanced Tab */}
        {activeTab === "advanced" && (
          <div className="space-y-4 animate-fadeIn">
            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Environment Registers</div>
              <p className="text-[11px] mb-3 opacity-80">Static credentials loaded in deployment environments.</p>
              <div className="space-y-2 text-[10px] font-mono">
                <div className="flex justify-between border-b border-gray-900 pb-1"><span>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</span><span className="text-green-500 font-bold">pk_test_***</span></div>
                <div className="flex justify-between border-b border-gray-900 pb-1"><span>GEMINI_API_KEY</span><span className="text-green-500 font-bold">AIza_***_active</span></div>
                <div className="flex justify-between border-b border-gray-900 pb-1"><span>OPENROUTER_API_KEY</span><span className="text-green-500 font-bold">sk-or-v1_***_active</span></div>
              </div>
              <p className="text-[9px] mt-3 opacity-60 leading-normal">
                Credentials cannot be directly overridden on client browser clusters. Update keys in Vercel Dashboard → Settings → Environment Variables.
              </p>
            </div>

            <div className="lit-box p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
              <div className="lit-header -mx-4 -mt-4 mb-3" style={{ color: "white" }}>Local Storage Clusters</div>
              <p className="text-[11px] opacity-80 mb-3">Clearing these will erase all local configurations, claimed LiTBit Coins, and custom moods.</p>
              <button
                onClick={() => { localStorage.clear(); window.location.reload(); }}
                className="px-4 py-2 text-[10px] font-bold border-2 transition-all active:scale-95"
                style={{ borderColor: "#ff4444", color: "#ff4444", backgroundColor: "transparent" }}
              >
                ⚠️ WIPE ALL LOCAL REGISTERS
              </button>
            </div>
          </div>
        )}

        {/* Saved indicator */}
        {saved && (
          <div className="fixed bottom-6 right-6 px-4 py-2 font-bold text-xs border-2 z-50 animate-bounce" style={{ borderColor: T.accentColor, backgroundColor: T.boxBg, color: T.accentColor }}>
            🚀 PARAMETERS UPDATED SUCCESSFULLY
          </div>
        )}
      </div>
    </PageShell>
  );
}
