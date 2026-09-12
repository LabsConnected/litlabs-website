import { Check, X } from "lucide-react";

const COMPARISON = [
  {
    chat: "Gives answers",
    litt: "Works on the project",
  },
  {
    chat: "Conversation context",
    litt: "Persistent project context",
  },
  {
    chat: "Generates snippets",
    litt: "Changes real files",
  },
  {
    chat: "Suggests commands",
    litt: "Uses tools and terminal with controls",
  },
  {
    chat: "Output stays in chat",
    litt: "Output becomes project assets",
  },
  {
    chat: "User stitches the workflow",
    litt: "LiTT coordinates the workflow",
  },
];

export function ComparisonTable() {
  return (
    <section id="why-litt" className="litt-section relative overflow-hidden border-t border-white/8 bg-[#05070d]">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[340px] w-[640px] -translate-x-1/2 rounded-full bg-[#65f4ff]/5 blur-[140px]" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow">
            <Check size={13} /> Why LiTT, not another chat
          </div>
          <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-white">
            Not a chat. <span className="litt-gradient-text">A working system.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-white/52 sm:text-lg sm:leading-8">
            AI chat gives you text. LiTT gives you a finished project with files, context, and a path to launch.
          </p>
        </div>

        <div data-reveal className="mt-12 overflow-hidden rounded-2xl border border-white/10 bg-[#080a10]">
          <div className="grid grid-cols-2 border-b border-white/8">
            <div className="flex items-center gap-2 px-5 py-4 text-sm font-black text-white/40 sm:px-7">
              <X size={16} className="text-white/30" /> AI chat
            </div>
            <div className="flex items-center gap-2 px-5 py-4 text-sm font-black text-[#a8ff2f] sm:px-7">
              <Check size={16} /> LiTT
            </div>
          </div>
          {COMPARISON.map((row, index) => (
            <div
              key={index}
              className={`grid grid-cols-2 ${index !== COMPARISON.length - 1 ? "border-b border-white/6" : ""}`}
            >
              <div className="flex items-start gap-2.5 px-5 py-4 text-sm text-white/40 sm:px-7">
                <X size={14} className="mt-0.5 shrink-0 text-white/20" />
                <span>{row.chat}</span>
              </div>
              <div className="flex items-start gap-2.5 border-l border-white/6 px-5 py-4 text-sm font-semibold text-white/72 sm:px-7">
                <Check size={14} className="mt-0.5 shrink-0 text-[#a8ff2f]" />
                <span>{row.litt}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
