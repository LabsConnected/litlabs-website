import {
  BrainCircuit,
  Download,
  FileCode2,
  GitBranch,
  Rocket,
  ShieldCheck,
} from "lucide-react";

const ITEMS = [
  {
    icon: BrainCircuit,
    title: "Project memory",
    copy: "Goals, decisions, style, and context carry forward across sessions, so the next conversation starts where the work left off.",
    label: "Persistent",
    accent: "#a8ff2f",
  },
  {
    icon: FileCode2,
    title: "Real files and assets",
    copy: "Code, images, audio, and documents are created in your project—not trapped inside a scroll of messages.",
    label: "Ownable",
    accent: "#65f4ff",
  },
  {
    icon: ShieldCheck,
    title: "Human approvals",
    copy: "Sensitive changes stop for your review. You can inspect the action and approve it before LiTT proceeds.",
    label: "Controlled",
    accent: "#b58cff",
  },
  {
    icon: GitBranch,
    title: "Version history",
    copy: "Project checkpoints preserve progress and provide a practical path back when the direction changes.",
    label: "Recoverable",
    accent: "#a8ff2f",
  },
  {
    icon: Download,
    title: "Export without lock-in",
    copy: "Download your work and take it with you. The output belongs to your project, not to the chat interface.",
    label: "Portable",
    accent: "#65f4ff",
  },
  {
    icon: Rocket,
    title: "A path to launch",
    copy: "Move from brief to preview, approval, and deployment in the same working environment when the project is ready.",
    label: "Launchable",
    accent: "#b58cff",
  },
] as const;

export function WhyDifferent() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ITEMS.map((item, index) => {
        const Icon = item.icon;
        return (
          <article key={item.title} data-reveal className="litt-difference-card group" style={{ "--difference-accent": item.accent, "--reveal-index": index } as React.CSSProperties}>
            <div className="flex items-center justify-between gap-3">
              <span className="litt-difference-icon"><Icon size={18} /></span>
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-white/25">0{index + 1}</span>
            </div>
            <h3 className="mt-7 text-xl font-black tracking-[-0.025em] text-white">{item.title}</h3>
            <p className="mt-3 text-sm leading-6 text-white/50">{item.copy}</p>
            <div className="litt-status-label mt-6 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: item.accent }}>
              <span className="h-px w-5 bg-current opacity-60" /> {item.label}
            </div>
          </article>
        );
      })}
    </div>
  );
}
