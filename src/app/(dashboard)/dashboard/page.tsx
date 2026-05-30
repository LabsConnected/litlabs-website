"use client";

import Link from "next/link";
import JobQueueMonitor from "@/components/JobQueueMonitor";

export default function DashboardPage() {
  const quickActions = [
    { href: "/agent-chat", icon: "⚡", title: "Neural Link", desc: "Direct AI connection", color: "cyan" },
    { href: "/marketplace", icon: "🔧", title: "Bot Forge", desc: "Acquire new daemons", color: "purple" },
    { href: "/social", icon: "👥", title: "The Matrix", desc: "Builder network", color: "gold" },
    { href: "/builder", icon: "🛠", title: "Forge Agent", desc: "Construct custom AI", color: "green" },
    { href: "/gallery", icon: "🏛", title: "Champions", desc: "Elite registry", color: "purple" },
    { href: "/settings", icon: "⚙", title: "System Config", desc: "Workspace params", color: "cyan" },
  ];

  const onboardingSteps = [
    {
      step: "01",
      color: "neon-cyan",
      title: "Establish Neural Link",
      desc: "Connect with pre-built champions through the Neural Link. Test their capabilities before full deployment.",
    },
    {
      step: "02",
      color: "neon-purple",
      title: "Forge Custom Daemons",
      desc: "Utilize the Bot Forge to construct agents tailored to your specific technical requirements and persona.",
    },
    {
      step: "03",
      color: "neon-gold",
      title: "Sync with Matrix",
      desc: "Enter the social hub to exchange technical logs and reputation with the global builder collective.",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-20">
      {/* Welcome Header */}
      <section>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div>
            <div className="text-[10px] font-bold text-neon-cyan tracking-[0.4em] uppercase mb-2">
              System_Status: Online
            </div>
            <h1 className="font-heading text-3xl sm:text-4xl font-bold mb-2 uppercase tracking-tight">
              Welcome back, <span className="gradient-text">Builder</span>
            </h1>
            <p className="text-text-secondary font-medium">
              Your CEO Operating System is initialized and ready.
            </p>
          </div>
          <div className="w-full lg:w-auto">
            <JobQueueMonitor />
          </div>
        </div>
        <div className="h-px mt-8 bg-gradient-to-r from-neon-cyan/20 via-neon-purple/20 to-transparent" />
      </section>

      {/* Quick Actions Grid */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-text-muted">
            Quick_Initialization
          </h2>
          <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickActions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="card group hover:border-neon-cyan/30 hover:scale-[1.02] transition-all duration-300"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 min-w-[48px] min-h-[48px] rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                  {a.icon}
                </div>
                <div>
                  <div className="text-base font-bold group-hover:text-neon-cyan transition-colors uppercase tracking-tight">
                    {a.title}
                  </div>
                  <div className="text-xs text-text-muted font-medium uppercase tracking-wider">
                    {a.desc}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="h-px mt-8 bg-gradient-to-r from-neon-purple/20 via-neon-cyan/10 to-transparent" />
      </section>

      {/* Onboarding / Getting Started */}
      <section className="glass-panel p-8 sm:p-12 border-neon-cyan/10 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-neon-cyan/5 blur-[100px]" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-neon-purple/5 blur-[80px]" />

        <div className="relative">
          <h2 className="font-heading text-xl font-bold mb-2 uppercase">
            🚀 System_Initialization_Guide
          </h2>
          <p className="text-text-secondary text-sm mb-10 font-medium max-w-2xl">
            Optimize your workflow by mastering the core dual-agent orchestration protocols.
          </p>

          {/* Gradient divider under description */}
          <div className="h-px mb-10 bg-gradient-to-r from-neon-cyan/20 via-neon-purple/20 to-transparent" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {onboardingSteps.map((s) => (
              <div key={s.step} className="space-y-4">
                <div className={`font-heading text-4xl font-bold opacity-20 text-${s.color}`}>
                  {s.step}
                </div>
                <div className="font-bold text-base uppercase tracking-tight">
                  {s.title}
                </div>
                <p className="text-xs text-text-muted font-medium leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
