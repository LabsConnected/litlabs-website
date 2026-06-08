"use client";

import { ReactNode, CSSProperties } from "react";
import { useTheme } from "@/context/ThemeContext";

type GlassCardVariant = "default" | "interactive" | "glow" | "flat";

interface GlassCardProps {
  children: ReactNode;
  variant?: GlassCardVariant;
  padding?: "none" | "sm" | "md" | "lg";
  radius?: "sm" | "md" | "lg";
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  header?: ReactNode;
  footer?: ReactNode;
}

const paddingMap = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-8",
};

const radiusMap = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
};

export default function GlassCard({
  children,
  variant = "default",
  padding = "md",
  radius = "md",
  className = "",
  style,
  onClick,
  header,
  footer,
}: GlassCardProps) {
  const { resolvedColors } = useTheme();

  const isInteractive = variant === "interactive" || onClick;
  const isGlow = variant === "glow";

  return (
    <div
      onClick={onClick}
      className={`
        glass-card
        ${paddingMap[padding]}
        ${radiusMap[radius]}
        ${isInteractive ? "cursor-pointer hover-lift" : ""}
        ${isGlow ? "glow-box" : ""}
        ${className}
      `}
      style={{
        borderColor: resolvedColors.borderColor + "40",
        ...style,
      }}
    >
      {header && (
        <div
          className="flex items-center justify-between mb-4 pb-3 border-b"
          style={{ borderColor: resolvedColors.borderColor + "20" }}
        >
          {header}
        </div>
      )}
      {children}
      {footer && (
        <div
          className="mt-4 pt-3 border-t flex items-center justify-between"
          style={{ borderColor: resolvedColors.borderColor + "20" }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
