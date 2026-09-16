"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Helper text shown under the input. */
  hint?: string;
  /** Error text. Sets aria-invalid and the error ring. */
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, className, disabled, "aria-describedby": describedBy, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const described = [describedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-sm font-medium text-white/85"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className={cn(
          "w-full min-h-[44px] rounded-xl bg-white/5 px-4 text-base text-white placeholder:text-white/35",
          "border border-white/12 transition-colors duration-200 motion-reduce:transition-none",
          "hover:border-white/20",
          "focus-visible:outline-none focus-visible:border-lime-300/60 focus-visible:ring-2 focus-visible:ring-[rgba(168,255,47,0.4)]",
          error && "border-red-400/60 focus-visible:border-red-300/70 focus-visible:ring-red-300/40",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-white/50">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
});
