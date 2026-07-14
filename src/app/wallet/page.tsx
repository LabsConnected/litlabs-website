"use client";

export const dynamic = "force-dynamic";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import {
  Wallet,
  Coins,
  Gift,
  Loader2,
  ArrowUpRight,
  ShoppingBag,
  Sparkles,
  Receipt,
} from "lucide-react";

type Tab = "overview" | "litbits" | "history";

export default function WalletPage() {
  return (
    <Suspense
      fallback={
        <PageShell title="Wallet" icon={<Wallet size={28} />}>
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin" size={28} />
          </div>
        </PageShell>
      }
    >
      <WalletContent />
    </Suspense>
  );
}

function WalletContent() {
  const { resolvedColors: T } = useTheme();
  const { balance, claimed, isLoading, isClaiming, claim } = useWallet();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const searchParams = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) || "overview";

  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  const signInMessage =
    isLoaded && !isSignedIn ? "Sign in to manage your wallet." : null;
  const displayClaimMsg = claimMsg ?? signInMessage;

  const handleClaim = useCallback(async () => {
    setClaimMsg(null);
    const ok = await claim();
    setClaimMsg(
      ok
        ? "Daily bonus claimed! +50 LiTBits"
        : "Already claimed today or sign in required.",
    );
  }, [claim]);

  const cardStyle = {
    backgroundColor: `${T.boxBg}60`,
    borderColor: T.borderColor + "30",
  };

  return (
    <PageShell
      title="Wallet"
      subtitle="LiTBit Coins balance, daily rewards, and purchases"
      icon={<Wallet size={28} />}
    >
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Balance hero */}
        <div className="rounded-2xl border p-6 md:p-8" style={cardStyle}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider opacity-60 mb-1">
                Balance
              </p>
              <div className="flex items-baseline gap-2">
                {isLoading ? (
                  <Loader2
                    className="animate-spin"
                    size={28}
                    style={{ color: T.accentColor }}
                  />
                ) : (
                  <>
                    <span
                      className="text-4xl md:text-5xl font-black"
                      style={{ color: T.headerColor }}
                    >
                      {balance.toLocaleString()}
                    </span>
                    <span className="text-sm font-bold opacity-60">
                      LiTBits
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleClaim}
                disabled={isClaiming || claimed || !isSignedIn}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}
              >
                {isClaiming ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Gift size={16} />
                )}
                {claimed ? "Claimed today" : "Claim daily +50"}
              </button>
              <Link
                href="/marketplace?tab=subscriptions"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold border transition-all hover:opacity-80"
                style={{
                  borderColor: T.borderColor + "40",
                  color: T.textColor,
                }}
              >
                <Coins size={16} /> Buy coins
              </Link>
            </div>
          </div>
          {displayClaimMsg && (
            <p
              className="mt-4 text-sm opacity-70"
              style={{ color: T.textMuted }}
            >
              {displayClaimMsg}
            </p>
          )}
        </div>

        {/* Quick links */}
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              href: "/marketplace",
              label: "Marketplace",
              icon: ShoppingBag,
              desc: "Buy agents & tools",
            },
            {
              href: "/studio",
              label: "Studio",
              icon: Sparkles,
              desc: "Spend on generation",
            },
            {
              href: "/wallet?tab=litbits",
              label: "LiTTs info",
              icon: Coins,
              desc: "How coins work",
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-xl border p-4 transition-all hover:opacity-90 group"
              style={cardStyle}
            >
              <item.icon
                size={20}
                style={{ color: T.accentColor }}
                className="mb-2"
              />
              <div
                className="font-bold text-sm flex items-center gap-1"
                style={{ color: T.headerColor }}
              >
                {item.label}
                <ArrowUpRight
                  size={14}
                  className="opacity-0 group-hover:opacity-60 transition-opacity"
                />
              </div>
              <p className="text-xs opacity-55 mt-1">{item.desc}</p>
            </Link>
          ))}
        </div>

        {/* Tab content */}
        {(tab === "litbits" || tab === "overview") && (
          <div className="rounded-2xl border p-6" style={cardStyle}>
            <h2
              className="text-lg font-black mb-3"
              style={{ color: T.headerColor }}
            >
              How LiTBits work
            </h2>
            <ul className="space-y-2 text-sm opacity-75">
              <li>• New accounts start with starter credits.</li>
              <li>• Claim +50 LiTBits every day for free.</li>
              <li>
                • Spend on Studio generation, agents, and marketplace items.
              </li>
              <li>• Buy more via Marketplace subscriptions or coin packs.</li>
            </ul>
          </div>
        )}

        {tab === "history" && (
          <div className="rounded-2xl border p-6" style={cardStyle}>
            <div className="flex items-center gap-2 mb-4">
              <Receipt size={18} style={{ color: T.accentColor }} />
              <h2
                className="text-lg font-black"
                style={{ color: T.headerColor }}
              >
                Transaction history
              </h2>
            </div>
            <p className="text-sm opacity-60">
              {isSignedIn
                ? "Full transaction history is coming soon. Check Marketplace → Purchases for recent orders."
                : "Sign in to view your transaction history."}
            </p>
            {isSignedIn && (
              <Link
                href="/marketplace?tab=purchases"
                className="inline-flex items-center gap-1 mt-4 text-sm font-bold"
                style={{ color: T.accentColor }}
              >
                View purchases <ArrowUpRight size={14} />
              </Link>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
