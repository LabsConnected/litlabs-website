"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createLittAppStore, type LittAppState, type LittAppStore } from "./store";

const LittAppStoreContext = createContext<LittAppStore | null>(null);

/**
 * One store per provider mount. A second LiTT App tree does not share
 * this instance, and neither tree shares Studio's global stores.
 */
export function LittAppStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState<LittAppStore>(() => createLittAppStore());
  return (
    <LittAppStoreContext.Provider value={store}>
      {children}
    </LittAppStoreContext.Provider>
  );
}

export function useLittAppStore<T>(selector: (state: LittAppState) => T): T {
  const store = useContext(LittAppStoreContext);
  if (!store) {
    throw new Error("useLittAppStore must be used within LittAppStoreProvider");
  }
  return useStore(store, selector);
}
