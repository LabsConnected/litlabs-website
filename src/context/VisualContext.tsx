"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

interface VisualContextValue {
  theme: "dark" | "light";
  accentColor: string;
}

const defaultVisualContext: VisualContextValue = {
  theme: "dark",
  accentColor: "#22d3ee",
};

const VisualContext = createContext<VisualContextValue>(defaultVisualContext);

export function VisualProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => defaultVisualContext, []);
  return <VisualContext.Provider value={value}>{children}</VisualContext.Provider>;
}

export function useVisualContext() {
  return useContext(VisualContext);
}
