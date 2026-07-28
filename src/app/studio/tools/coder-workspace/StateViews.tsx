/**
 * Truthful state components for the CoderWorkspace shell.
 * Empty, loading, and error states — no fake data.
 */

import type { LoadStatus } from "./types";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-white/60">
        {title}
      </p>
      <p className="max-w-xs text-[11px] leading-relaxed text-white/40">
        {body}
      </p>
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-red-300">
        Error
      </p>
      <p className="max-w-xs text-[11px] leading-relaxed text-red-200/70">
        {message}
      </p>
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      <p className="text-[11px] text-white/40">{label}</p>
    </div>
  );
}

export type { LoadStatus };
