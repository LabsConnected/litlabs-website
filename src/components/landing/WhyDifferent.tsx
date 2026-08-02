import { BrainCircuit, Check, Download, FileCode, GitBranch, Rocket, Shield } from "lucide-react";

interface Differentiator { icon: typeof BrainCircuit; title: string; copy: string; accent: string; visual: "memory" | "files" | "approval" | "history" | "export" | "launch"; }

const ITEMS: Differentiator[] = [
  { icon: BrainCircuit, title: "Project memory", copy: "Decisions, style, goals, and context carry forward across every session. Return tomorrow and keep moving.", accent: "#a8ff2f", visual: "memory" },
  { icon: FileCode, title: "Real files and assets", copy: "Code, images, audio, and documents are created in your workspace—not lost in a chat scroll.", accent: "#65f4ff", visual: "files" },
  { icon: Shield, title: "Human approvals", copy: "Sensitive actions like deployment or deletion require your explicit approval. LiTT never acts without you.", accent: "#b58cff", visual: "approval" },
  { icon: GitBranch, title: "Version history", copy: "Every checkpoint is saved. Roll back to any point in the project's history with one click.", accent: "#a8ff2f", visual: "history" },
  { icon: Download, title: "Export and ownership", copy: "Your work is yours. Export files, code, and assets anytime. No lock-in, no hidden terms.", accent: "#65f4ff", visual: "export" },
  { icon: Rocket, title: "Launch workflow", copy: "Go from idea to deployed project without leaving Studio. Preview, approve, and ship in one place.", accent: "#b58cff", visual: "launch" },
];

export function WhyDifferent() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.title} className="group overflow-hidden rounded-2xl border border-white/10 bg-[#0a0d14] transition duration-300 hover:-translate-y-0.5 hover:border-white/20">
            <div className="relative h-28 overflow-hidden border-b border-white/8" style={{ background: `linear-gradient(135deg, ${item.accent}08, transparent 70%)` }}><MiniVisual type={item.visual} accent={item.accent} /></div>
            <div className="p-5">
              <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `${item.accent}12`, color: item.accent }}><Icon size={15} /></span><h3 className="text-sm font-black text-white">{item.title}</h3></div>
              <p className="mt-3 text-xs leading-5 text-white/50">{item.copy}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MiniVisual({ type, accent }: { type: Differentiator["visual"]; accent: string }) {
  switch (type) {
    case "memory": return (<div className="flex h-full items-center gap-2 px-4">{["Idea", "Plan", "Files", "Launch"].map((s, i) => (<div key={s} className="flex items-center gap-2"><div className="rounded-md border px-2 py-1 text-[9px] font-bold" style={{ borderColor: i === 3 ? `${accent}40` : "rgba(255,255,255,.08)", backgroundColor: i === 3 ? `${accent}10` : "rgba(255,255,255,.03)", color: i === 3 ? accent : "rgba(255,255,255,.4)" }}>{s}</div>{i < 3 && <div className="h-px w-3" style={{ backgroundColor: "rgba(255,255,255,.1)" }} />}</div>))}</div>);
    case "files": return (<div className="flex h-full items-center gap-1.5 px-4">{["index.html", "styles.css", "player.js", "assets/"].map((f) => (<div key={f} className="flex items-center gap-1 rounded border border-white/8 bg-white/3 px-2 py-1 text-[9px] font-bold text-white/40"><FileCode size={8} style={{ color: `${accent}80` }} />{f}</div>))}</div>);
    case "approval": return (<div className="flex h-full items-center justify-center px-4"><div className="rounded-lg border px-3 py-2" style={{ borderColor: `${accent}25`, backgroundColor: `${accent}08` }}><div className="flex items-center gap-2"><Check size={10} style={{ color: accent }} /><span className="text-[9px] font-black" style={{ color: accent }}>APPROVE DEPLOY</span></div></div></div>);
    case "history": return (<div className="flex h-full flex-col justify-center gap-1 px-4">{["Checkpoint 3", "Checkpoint 2", "Checkpoint 1"].map((c, i) => (<div key={c} className="flex items-center gap-2"><GitBranch size={8} style={{ color: i === 0 ? accent : "rgba(255,255,255,.2)" }} /><span className="text-[9px] font-bold" style={{ color: i === 0 ? accent : "rgba(255,255,255,.3)" }}>{c}</span>{i === 0 && <span className="rounded px-1.5 py-0.5 text-[8px] font-black" style={{ backgroundColor: `${accent}15`, color: accent }}>CURRENT</span>}</div>))}</div>);
    case "export": return (<div className="flex h-full items-center justify-center gap-2 px-4"><div className="rounded-lg border border-white/10 bg-white/3 px-3 py-2"><Download size={14} style={{ color: accent }} /></div><div className="text-[9px] font-bold text-white/40">Export all files</div></div>);
    case "launch": return (<div className="flex h-full items-center justify-center px-4"><div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: `${accent}25`, backgroundColor: `${accent}08` }}><Rocket size={12} style={{ color: accent }} /><span className="text-[9px] font-black" style={{ color: accent }}>DEPLOYED</span><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} /></div></div>);
    default: return null;
  }
}
