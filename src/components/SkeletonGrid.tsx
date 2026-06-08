"use client";

import { useTheme } from "@/context/ThemeContext";

interface SkeletonGridProps {
  count?: number;
  columns?: number;
  className?: string;
}

export default function SkeletonGrid({ count = 6, columns = 3, className = "" }: SkeletonGridProps) {
  const { resolvedColors } = useTheme();

  return (
    <div
      className={`grid gap-4 ${className}`}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border p-4 space-y-3 shimmer"
          style={{
            borderColor: resolvedColors.borderColor + "20",
            backgroundColor: resolvedColors.boxBg + "40",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full"
              style={{ backgroundColor: resolvedColors.borderColor + "30" }}
            />
            <div className="space-y-1.5 flex-1">
              <div
                className="h-3 w-1/3 rounded"
                style={{ backgroundColor: resolvedColors.borderColor + "30" }}
              />
              <div
                className="h-2 w-1/2 rounded"
                style={{ backgroundColor: resolvedColors.borderColor + "20" }}
              />
            </div>
          </div>
          <div
            className="h-24 rounded"
            style={{ backgroundColor: resolvedColors.borderColor + "20" }}
          />
          <div className="flex gap-2">
            <div
              className="h-8 flex-1 rounded"
              style={{ backgroundColor: resolvedColors.borderColor + "20" }}
            />
            <div
              className="h-8 flex-1 rounded"
              style={{ backgroundColor: resolvedColors.borderColor + "20" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
