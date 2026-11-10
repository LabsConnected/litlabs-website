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
    <section id="why-litt" className="litt-section relative overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[340px] w-[640px] -translate-x-1/2 rounded-full bg-[#177A36]/5 blur-[140px]" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow">
            <Check size={13} /> Why LiTT, not another chat
          </div>
          <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-[#0E1510]">
            Not a chat. <span className="litt-gradient-text">A working system.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-[#63745F] sm:text-lg sm:leading-8">
            AI chat gives you text. LiTT gives you a finished project with files, context, and a path to launch.
          </p>
        </div>

        <div data-reveal className="mt-12 overflow-hidden rounded-2xl border border-[#CFDEC4] bg-white shadow-[0_20px_54px_rgba(14,60,26,0.14)]">
          <div className="grid grid-cols-2 border-b border-[#CFDEC4]">
            <div className="flex items-center gap-2 px-5 py-4 text-sm font-black text-[#63745F] sm:px-7">
              <X size={16} className="text-[#63745F]/70" /> AI chat
            </div>
            <div className="flex items-center gap-2 px-5 py-4 text-sm font-black text-accent sm:px-7">
              <Check size={16} /> LiTT
            </div>
          </div>
          {COMPARISON.map((row, index) => (
            <div
              key={index}
              className={`grid grid-cols-2 ${index !== COMPARISON.length - 1 ? "border-b border-[#EDF3E4]" : ""}`}
            >
              <div className="flex items-start gap-2.5 px-5 py-4 text-sm text-[#63745F] sm:px-7">
                <X size={14} className="mt-0.5 shrink-0 text-[#B9C9AE]" />
                <span>{row.chat}</span>
              </div>
              <div className="flex items-start gap-2.5 border-l border-[#EDF3E4] px-5 py-4 text-sm font-semibold text-[#0E1510] sm:px-7">
                <Check size={14} className="mt-0.5 shrink-0 text-accent" />
                <span>{row.litt}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
