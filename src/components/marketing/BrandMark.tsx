import { Bot } from "lucide-react";

export default function BrandMark() {
  return (
    <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 text-[#a8ff2f] shadow-[0_0_26px_rgba(168,255,47,.16)]">
      <Bot size={18} />
      <span className="absolute inset-x-1 bottom-0 h-px bg-linear-to-r from-transparent via-[#a8ff2f] to-transparent" />
    </span>
  );
}
