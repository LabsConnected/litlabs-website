"use client";

import { useState } from "react";
import Image from "next/image";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * 44px-square (default) avatar with initials fallback.
 * Uses next/image; falls back to an initials tile when the src is missing or fails.
 */
export function Avatar({
  src,
  name,
  size = 44,
  ring = false,
  online = false,
  className,
}: {
  src: string | null;
  name: string;
  size?: number;
  ring?: boolean;
  online?: boolean;
  className?: string;
}) {
  const { tokens } = useTheme();
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden={false}
    >
      {!failed && src ? (
        <Image
          src={src}
          alt={name}
          width={size}
          height={size}
          className="rounded-full object-cover"
          style={{
            width: size,
            height: size,
            border: ring ? `2px solid ${tokens.primary}` : "none",
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="flex items-center justify-center rounded-full font-bold"
          style={{
            width: size,
            height: size,
            backgroundColor: tokens.primary + "26",
            color: tokens.primary,
            border: ring ? `2px solid ${tokens.primary}` : `1px solid ${tokens.border}`,
            fontSize: Math.round(size * 0.36),
          }}
        >
          {initials(name)}
        </span>
      )}
      {online && (
        <span
          className="absolute bottom-0 right-0 rounded-full border-2"
          style={{
            width: Math.round(size * 0.3),
            height: Math.round(size * 0.3),
            backgroundColor: tokens.success,
            borderColor: tokens.background,
          }}
        />
      )}
    </span>
  );
}
