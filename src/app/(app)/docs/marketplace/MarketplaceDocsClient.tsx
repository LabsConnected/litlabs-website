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
        The Marketplace is the public roadmap of capabilities being built
        into LiTT — specialist tools, workflows, integrations, and agents.
        Nothing here is installable yet: listings show what each capability
        will do and where it stands.
      </DocIntro>

      <DocH2 id="what-it-is">What you&apos;ll find</DocH2>
      <DocP>
        Each listing describes one capability in development: what it will
        do, which assistant it&apos;s for, and its status.{" "}
        <strong>In development</strong> means we&apos;re actively building
        it; <strong>Coming soon</strong> means it&apos;s planned but work
        hasn&apos;t started.
      </DocP>

      <DocH2 id="installing">When installs go live</DocH2>
      <DocP>
        A capability becomes installable the moment it has a real executor
        — actual code LiTT can run, not a placeholder. When that happens,
        an Install button appears on its listing automatically. Installing
        will wire the capability into your workspace so LiTT can genuinely
        use it. Until then, there is nothing to install, and no install
        button is shown.
      </DocP>
      <Callout kind="note" title="No fake installs">
        The Marketplace never pretends. If a listing has no Install button,
        the capability isn&apos;t real yet — installing a row in a database
        would give LiTT no new ability, so we don&apos;t offer it.
      </Callout>

      <DocH2 id="using">Using installed capabilities</DocH2>
      <DocP>
        Once capabilities become installable, installed ones will show up
        where they&apos;re used — including the agent selector in Studio
        chat. Pick the specialist for the job the same way you&apos;d pick
        a built-in agent like Coder or Writer.
      </DocP>

      <DocH2 id="pricing">Pricing</DocH2>
      <DocP>
        Marketplace capabilities follow LiTT&apos;s standard plans — see{" "}
        <Link
          href="/pricing"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          /pricing
        </Link>{" "}
        for current prices. Nothing on the{" "}
        <Link
          href={marketplaceHref}
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Marketplace
        </Link>{" "}
        charges anything today.
      </DocP>

      <DocH2 id="feedback">Shape the roadmap</DocH2>
      <DocP>
        Tell us which capabilities you want first — your feedback decides
        build order. Reach us from Studio chat or{" "}
        <a
          href="mailto:beta@litlabs.net"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          beta@litlabs.net
        </a>
        .
      </DocP>
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
            to see what&apos;s in development.
          </>,
          <>
            Tell us which capabilities you want first — via Studio chat or{" "}
            <a
              href="mailto:beta@litlabs.net"
              className="font-bold underline decoration-dotted underline-offset-4"
              style={{ color: T.accentColor }}
            >
              beta@litlabs.net
            </a>{" "}
            — and we&apos;ll prioritize accordingly.
          </>,
        ]}
      />
    </>
  );
}
