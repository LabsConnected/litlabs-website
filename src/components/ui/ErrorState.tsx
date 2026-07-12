"use client";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const { tokens } = useTheme();

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl sm:rounded-2xl border p-6 sm:p-8 text-center",
        className,
      )}
      style={{ borderColor: tokens.danger + "40", backgroundColor: tokens.danger + "10" }}
    >
      <div className="text-sm font-bold" style={{ color: tokens.danger }}>
        {title}
      </div>
      {description && (
        <div className="mt-1 max-w-xs text-xs" style={{ color: tokens.textMuted }}>
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
