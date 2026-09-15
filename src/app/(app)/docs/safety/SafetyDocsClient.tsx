"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import {
  DocH1,
  DocH2,
  DocIntro,
  DocP,
  DocList,
  InlineCode,
  Callout,
  CodeBlock,
} from "../_components/DocPrimitives";

export default function SafetyDocsClient() {
  const { resolvedColors: T } = useTheme();

  return (
    <>
      <p
        className="mb-3 text-xs font-bold uppercase tracking-[0.28em]"
        style={{ color: T.accentColor }}
      >
        Platform
      </p>
      <DocH1>Safety & Approvals</DocH1>
      <DocIntro>
        LiTT can edit files, run commands, and publish projects — real
        power, so it&apos;s gated by approvals. Here&apos;s what asks for
        your permission, and how to tune it.
      </DocIntro>

      <DocH2 id="principle">The principle</DocH2>
      <DocP>
        <strong>Exploring is free; consequential actions ask first.</strong>{" "}
        LiTT can read your project, plan, and show you previews without
        bothering you. Anything that changes the world outside your
        workspace — deploying, publishing, or other irreversible steps —
        asks for your approval first. You stay the one who decides what
        ships.
      </DocP>

      <DocH2 id="studio-approvals">Approvals in Studio</DocH2>
      <DocList
        items={[
          <>
            <strong>Deployment and publishing</strong> may present an
            approval step before anything goes live. Approve it and the
            deploy proceeds; decline or ignore it and nothing publishes.
          </>,
          <>
            <strong>Plan review.</strong> For larger missions, LiTT shows
            its plan before acting — that&apos;s your cheapest moment to
            steer or stop.
          </>,
          <>
            <strong>Session expiry.</strong> If your session expires
            mid-conversation, Studio tells you and asks you to sign in
            again rather than continuing in a broken state.
          </>,
        ]}
      />
      <Callout kind="tip" title="Approvals are per action">
        Approving one deployment doesn&apos;t approve the next one. Each
        consequential action asks on its own, so a “yes” never becomes a
        blank check.
      </Callout>

      <DocH2 id="cli-modes">Permission modes in the CLI</DocH2>
      <DocP>
        The CLI lets you set how autonomous LiTT should be with{" "}
        <InlineCode>--mode</InlineCode>:
      </DocP>
      <CodeBlock label="Permission modes">
        {`litt --mode plan    # plan only — LiTT proposes, you approve each step
litt --mode act     # act with approvals (default)
litt --mode auto    # proceed autonomously`}
      </CodeBlock>
      <DocList
        items={[
          <>
            <InlineCode>plan</InlineCode> is the most cautious: LiTT lays
            out what it would do and waits.
          </>,
          <>
            <InlineCode>act</InlineCode> (the default) does the work but
            still asks before consequential steps.
          </>,
          <>
            <InlineCode>auto</InlineCode> proceeds without pausing —
            useful for trusted, repeatable workflows.
          </>,
        ]}
      />
      <DocP>
        Separately, <InlineCode>LITT_LOCAL_ONLY=1</InlineCode> blocks all
        remote and model use, forcing the CLI to stay fully local.
      </DocP>

      <DocH2 id="models">Models & routing</DocH2>
      <DocP>
        In Studio chat you choose how requests are handled:
      </DocP>
      <DocList
        items={[
          <>
            <strong>LiTT Auto</strong> routes your request automatically —
            you describe the goal and LiTT picks how to handle it.
          </>,
          <>
            <strong>Specific agents and models</strong> let you take control:
            pick a specialist agent, and pick the underlying model —
            including your own API keys — with live provider health
            (available, degraded, locked) shown in the selector.
          </>,
        ]}
      />
      <DocP>
        If a provider fails, Studio reports the failure openly instead of
        silently falling back — see{" "}
        <Link
          href="/docs/troubleshooting"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Troubleshooting
        </Link>
        .
      </DocP>

      <DocH2 id="best-practices">Best practices</DocH2>
      <DocList
        items={[
          <>Review the plan before big missions — steering early is cheaper than reverting late.</>,
          <>Check the preview before approving a deploy. “Done” means LiTT finished its steps; the preview is the source of truth.</>,
          <>Use the activity timeline to audit what changed and what ran, especially before publishing.</>,
          <>Keep <InlineCode>--mode auto</InlineCode> for workflows you&apos;ve already watched succeed, not for first-time experiments.</>,
        ]}
      />
    </>
  );
}
