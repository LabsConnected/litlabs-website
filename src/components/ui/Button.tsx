"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "violet";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  // The ONE dominant action per surface. Dark text on lime for contrast (text-on-accent, 12.9:1).
  primary:
    "bg-accent text-on-accent font-semibold hover:bg-accent-strong active:bg-accent-strong shadow-accent-glow hover:shadow-accent-glow-strong",
  secondary:
    "bg-white/10 text-white border border-white/12 hover:bg-white/15 active:bg-white/20",
  ghost: "text-white/80 hover:text-white hover:bg-white/10 active:bg-white/15",
  danger:
    "bg-red-500/15 text-red-300 border border-red-400/30 hover:bg-red-500/25 active:bg-red-500/30",
  // Restrained violet — creative/spark moments only, never the primary CTA.
  violet:
    "bg-violet-400/15 text-violet-200 border border-violet-400/30 hover:bg-violet-400/25 active:bg-violet-400/30",
};

const sizeClasses: Record<ButtonSize, string> = {
  // All sizes guarantee the 44px minimum touch target.
  sm: "min-h-[44px] px-4 text-sm rounded-xl",
  md: "min-h-[44px] px-5 text-sm rounded-xl",
  lg: "min-h-[52px] px-6 text-base rounded-2xl",
  icon: "h-[44px] w-[44px] rounded-xl",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables interaction, sets aria-busy. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    disabled,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 select-none cursor-pointer",
        "transition-colors duration-200 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07080c]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
        variantClasses[variant],
        sizeClasses[size],
        size === "icon" && "p-0",
        className,
      )}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      )}
      {children}
    </button>
  );
});
