"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface NavDrawerContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const NavDrawerContext = createContext<NavDrawerContextValue | null>(null);

export function NavDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <NavDrawerContext.Provider value={{ open, setOpen, toggle }}>
      {children}
    </NavDrawerContext.Provider>
  );
}

export function useNavDrawer() {
  const context = useContext(NavDrawerContext);
  if (!context) {
    throw new Error("useNavDrawer must be used within a NavDrawerProvider");
  }
  return context;
}
