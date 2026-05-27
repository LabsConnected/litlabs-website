"use client";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";

export default function DashboardPage() {
  const { user } = useAuth();

  const quickActions = [
    { href: "/agent-chat", icon: "⚡", title: "AI Chat", desc: "Talk to any agent", color: "cyan" },
    { href: "/marketplace", icon: "🔧", title: "Bot Forge", desc: "Browse agents", color: "purple" },
    { href: "/social", icon: "👥", title: "Social Hub", desc: "Connect & share", color: "gold" },
    { href: "/builder", icon: "🛠", title: "Build Agent", desc: "Create your own", color: "green" },
    { href: "/gallery", icon: "🏛", title: "Agent Gallery", desc: "Explore all agents", color: "purple" },
    { href: "/settings", icon: "⚙", title: "Settings", desc: "Configure workspace", color: "cyan" },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold mb-1">
          Welcome back, <span className="text-neon-cyan">{user?.name || user?.email?.split("@")[0] || "Builder"}</span>
        </h1>
        <p className="text-text-secondary">Your AI workspace is ready.</p>
      </div>

      {/* Quick Actions */}
      <h2 className="font-heading text-lg font-semibold mb-4">Quick Actions</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {quickActions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="card group"
          >
            <div className="text-2xl mb-2">{a.icon}</div>
            <div className="text-sm font-semibold group-hover:text-neon-cyan transition-colors">{a.title}</div>
            <div className="text-xs text-text-muted">{a.desc}</div>
          </Link>
        ))}
      </div>

      {/* Get Started */}
      <div className="card bg-gradient-to-br from-neon-cyan/5 to-neon-purple/5 border-neon-cyan/20">
        <h2 className="font-heading text-lg font-semibold mb-2">🚀 Get Started</h2>
        <p className="text-text-secondary text-sm mb-4">
          New to LitLabs? Here&apos;s how to get the most out of your AI workspace.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-cyber-surface-2 rounded-lg p-4">
            <div className="text-neon-cyan font-code text-lg mb-1">01</div>
            <div className="font-medium text-sm mb-1">Chat with Agents</div>
            <p className="text-xs text-text-muted">Try the floating chat bubble or visit the Agent Gallery to talk to pre-built AI agents.</p>
          </div>
          <div className="bg-cyber-surface-2 rounded-lg p-4">
            <div className="text-neon-purple font-code text-lg mb-1">02</div>
            <div className="font-medium text-sm mb-1">Build Your Own</div>
            <p className="text-xs text-text-muted">Use the Bot Builder to create a custom agent. Set its personality, skills, and deploy.</p>
          </div>
          <div className="bg-cyber-surface-2 rounded-lg p-4">
            <div className="text-neon-gold font-code text-lg mb-1">03</div>
            <div className="font-medium text-sm mb-1">Join the Community</div>
            <p className="text-xs text-text-muted">Share wins, post in Social Hub, and enter agents in weekly Arena challenges.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
