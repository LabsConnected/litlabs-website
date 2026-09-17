"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";

export interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

/** Lightweight toast state hook shared by feed components. */
export function useToastState(): [ToastItem | null, (message: string, type?: ToastItem["type"]) => void] {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string, type: ToastItem["type"] = "info") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: Date.now(), message, type });
      timer.current = setTimeout(() => setToast(null), 3200);
    },
    [],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return [toast, showToast];
}

export function Toast({ toast }: { toast: ToastItem | null }) {
  const { tokens } = useTheme();
  if (!toast) return null;
  const color =
    toast.type === "success"
      ? tokens.success
      : toast.type === "error"
        ? tokens.danger
        : tokens.primary;
  const Icon = toast.type === "success" ? CheckCircle2 : toast.type === "error" ? AlertTriangle : Info;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 sm:bottom-6 left-1/2 z-[200] -translate-x-1/2 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg"
      style={{
        backgroundColor: tokens.surfaceElevated,
        borderColor: color,
        color: tokens.text,
      }}
    >
      <Icon size={18} style={{ color }} className="shrink-0" />
      <span className="break-words">{toast.message}</span>
    </div>
  );
}
