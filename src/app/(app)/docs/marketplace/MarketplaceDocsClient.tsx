"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  DocH1,
  DocH2,
  DocIntro,
  DocP,
  DocList,
  Callout,
} from "../_components/DocPrimitives";

export default function MarketplaceDocsClient() {
  const { resolvedColors: T } = useTheme();
  const { isSignedIn, isLoaded } = useClerkAuth();
  const signedIn = isLoaded && isSignedIn;
  const marketplaceHref =
    signedIn === false
      ? "/sign-in?redirect_url=%2Fmarketplace"
      : "/marketplace";

  return (
    <>
      <p
        className="mb-3 text-xs font-bold uppercase tracking-[0.28em]"
        style={{ color: T.accentColor }}
      >
        Platform
      </p>
      <DocH1>Marketplace</DocH1>
      <DocIntro>
        The Marketplace is where you install specialist agents that extend
        what LiTT can do — for code, content, research, support, analytics,
        and more.
      </DocIntro>

      <DocH2 id="what-it-is">What you&apos;ll find</DocH2>
      <DocP>
        Each listing is a specialist agent with a description, a price, and
        ratings from other users. Examples of installable agents include
        code review assistants, blog post writers, product description
        writers, AI customer support, AI meeting notes, legal document
        analyzers, and brand kit generators. Some listings are marked{" "}
        <strong>Coming soon</strong>{" "}— those aren&apos;t installable yet.
      </DocP>

      <DocH2 id="installing">Installing an agent</DocH2>
      <DocList
        items={[
          <>
            Browse the{" "}
            <Link
              href={marketplaceHref}
              className="font-bold underline decoration-dotted underline-offset-4"
              style={{ color: T.accentColor }}
            >
              Marketplace
            </Link>{" "}
            and open the agent you want.
          </>,
          <>
            Installing requires an account — if you&apos;re signed out,
            you&apos;ll be asked to sign in first, then returned to the
            Marketplace.
          </>,
          <>
            Confirm the install. The agent becomes available in your
            workspace alongside the built-in specialists.
          </>,
        ]}
      />
      <Callout kind="note" title="Signed out?">
        The install buttons read “Sign in to install” until you have an
        account. After sign-in you&apos;re redirected straight back to the
        Marketplace so you can pick up where you left off.
      </Callout>

      <DocH2 id="using">Using installed agents</DocH2>
      <DocP>
        Installed agents show up where agents live — including the agent
        selector in Studio chat. Pick the specialist for the job the same
        way you&apos;d pick a built-in agent like Coder or Writer: open the
        selector in the composer and choose it.
      </DocP>

      <DocH2 id="pricing">Pricing</DocH2>
      <DocP>
        Agents are priced individually — listings show their price up front,
        so there are no surprises. Check each listing for its current price
        and what&apos;s included before installing.
      </DocP>
    </>
  );
}
