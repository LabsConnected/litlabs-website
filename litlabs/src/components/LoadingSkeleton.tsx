"use client";

import { useTheme } from "@/context/ThemeContext";

interface LoadingSkeletonProps {
  type?: "card" | "list" | "text" | "avatar" | "button";
  count?: number;
  height?: string;
}

export default function LoadingSkeleton({ 
  type = "card", 
  count = 1, 
  height = "100%" 
}: LoadingSkeletonProps) {
  const { resolvedColors: T } = useTheme();

  const renderSkeleton = () => {
    switch (type) {
      case "card":
        return (
          <div 
            className="rounded-xl animate-pulse"
            style={{ 
              backgroundColor: T.boxBg + "30", 
              border: `1px solid ${T.borderColor}20`,
              height 
            }}
          />
        );
      case "list":
        return (
          <div 
            className="rounded-lg animate-pulse"
            style={{ 
              backgroundColor: T.bgColor + "30", 
              height: "40px" 
            }}
          />
        );
      case "text":
        return (
          <div 
            className="rounded animate-pulse"
            style={{ 
              backgroundColor: T.textMuted + "20", 
              height: "16px",
              width: "60%"
            }}
          />
        );
      case "avatar":
        return (
          <div 
            className="rounded-full animate-pulse"
            style={{ 
              backgroundColor: T.boxBg + "30", 
              width: "40px",
              height: "40px"
            }}
          />
        );
      case "button":
        return (
          <div 
            className="rounded-lg animate-pulse"
            style={{ 
              backgroundColor: T.accentColor + "20", 
              height: "40px",
              width: "120px"
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>{renderSkeleton()}</div>
      ))}
    </div>
  );
}
