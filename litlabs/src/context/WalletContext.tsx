"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";

interface WalletContextType {
  balance: number;
  claimed: boolean;
  isLoading: boolean;
  isClaiming: boolean;
  claim: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

function isSameDay(a: string | null | undefined, b: Date): boolean {
  if (!a) return false;
  const d = new Date(a);
  return (
    d.getFullYear() === b.getFullYear() &&
    d.getMonth() === b.getMonth() &&
    d.getDate() === b.getDate()
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [balance, setBalance] = useState(0);
  const [claimed, setClaimed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isClaiming, setIsClaiming] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet");
      if (!res.ok) {
        if (res.status === 401) {
          setBalance(0);
          setClaimed(false);
        }
        return;
      }
      const data = await res.json();
      setBalance(typeof data.balance === "number" ? data.balance : 0);
      setClaimed(isSameDay(data.last_claim_date, new Date()));
    } catch {
      // Keep existing optimistic state on network error
    } finally {
      setIsLoading(false);
    }
  }, []);

  const claim = useCallback(async () => {
    if (isClaiming || claimed) return false;
    setIsClaiming(true);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "daily" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error?.includes("already claimed")) setClaimed(true);
        return false;
      }
      setBalance(typeof data.balance === "number" ? data.balance : balance);
      setClaimed(true);
      return true;
    } catch {
      return false;
    } finally {
      setIsClaiming(false);
    }
  }, [balance, claimed, isClaiming]);

  useEffect(() => {
    let active = true;
    fetch("/api/wallet")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setBalance(typeof data.balance === "number" ? data.balance : 0);
        setClaimed(isSameDay(data.last_claim_date, new Date()));
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [refresh]);

  return (
    <WalletContext.Provider
      value={{ balance, claimed, isLoading, isClaiming, claim, refresh }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return context;
}
