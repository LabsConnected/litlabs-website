import { Bot } from "lucide-react";

export default function BrandMark() {
  return (
    <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-accent/30 bg-accent/10 text-accent shadow-accent-glow">
      <Bot size={18} />
      <span className="absolute inset-x-1 bottom-0 h-px bg-linear-to-r from-transparent via-accent to-transparent" />
    </span>
  );
}
