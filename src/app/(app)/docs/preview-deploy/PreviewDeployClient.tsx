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
  TermList,
} from "../_components/DocPrimitives";

export default function PreviewDeployClient() {
  const { resolvedColors: T } = useTheme();

  return (
    <>
      <p
        className="mb-3 text-xs font-bold uppercase tracking-[0.28em]"
        style={{ color: T.accentColor }}
      >
        Studio
      </p>
      <DocH1>Preview & Deployment</DocH1>
      <DocIntro>
        Preview and deployment answer two different questions.{" "}
        <strong>Preview:</strong>{" "}“does this work?” <strong>Deployment:</strong>{" "}
        “is this live for the world?” Here&apos;s how each one works — and
        how to recover when either misbehaves.
      </DocIntro>

      <Callout kind="note" title="The key distinction">
        Preview is your private working copy — iterate freely, nothing is
        public. Deployment is the deliberate step that publishes the project.
        You can preview a hundred times; you deploy when you decide
        it&apos;s ready.
      </Callout>

      <DocH2 id="how-preview-works">How preview works</DocH2>
      <DocP>
        The <strong>Preview</strong>{" "}tab runs your active project in a live
        runtime so you can click through it exactly as a visitor would.
        Studio mounts exactly one preview per active project — you&apos;ll
        never have two competing copies of the same project running.
      </DocP>
      <DocList
        items={[
          <>
            <strong>It starts automatically.</strong>{" "}Open the Preview tab or
            select a project and Studio provisions the workspace and starts
            the preview runtime on its own.
          </>,
          <>
            <strong>It follows the active project.</strong>{" "}Switch projects
            and the preview switches with it — the previous project&apos;s
            preview stops being the one on screen.
          </>,
          <>
            <strong>It can go stale.</strong>{" "}If LiTT edits files while
            you&apos;re looking at the preview, the panel may report
            “Preview may be stale.” Refresh it to see the latest build.
          </>,
        ]}
      />

      <DocH2 id="preview-states">Preview states & recovery</DocH2>
      <DocP>
        The preview panel always tells you what&apos;s happening. Here&apos;s
        what each state means and what to do:
      </DocP>
      <TermList
        terms={[
          {
            term: "Preparing preview…",
            definition:
              "The workspace is being provisioned and the runtime is starting. Wait — this resolves on its own.",
          },
          {
            term: "Preview ready",
            definition:
              "The project is running. Click through it like a visitor would.",
          },
          {
            term: "Preview may be stale",
            definition:
              "Files changed since the preview loaded. Refresh the preview to see the latest version.",
          },
          {
            term: "Preview not started",
            definition:
              "The runtime never started. Use the panel's start/retry action to kick it off.",
          },
          {
            term: "Preview runtime unreachable / failed to start",
            definition:
              "Something went wrong starting the runtime. Use Retry — or Restart preview after a failure — to try again. If it keeps failing, see Troubleshooting.",
          },
        ]}
      />
      <DocP>
        The retry button is in the preview panel itself, next to the status.
        Retrying is safe and idempotent — it won&apos;t duplicate your
        project or lose files. If retries keep failing, work through{" "}
        <Link
          href="/docs/troubleshooting"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Troubleshooting
        </Link>
        .
      </DocP>

      <DocH2 id="deployment">Deployment</DocH2>
      <DocP>
        When the preview looks right, the <strong>Deploy</strong>{" "}action in
        the Studio header prepares your project to go live. Deployment is
        separate from preview on purpose: it&apos;s the moment you decide
        the world should see the project.
      </DocP>
      <DocList
        items={[
          <>
            <strong>Approval first.</strong>{" "}Deploying is a consequential
            action, so it may ask for your approval before anything
            publishes. Nothing ships without you saying so — see{" "}
            <Link
              href="/docs/safety"
              className="font-bold underline decoration-dotted underline-offset-4"
              style={{ color: T.accentColor }}
            >
              Safety & Approvals
            </Link>
            .
          </>,
          <>
            <strong>Verified URL.</strong>{" "}A successful deployment produces a
            live URL, and LiTT verifies it&apos;s reachable — the deployment
            isn&apos;t “done” until the live project actually responds.
          </>,
          <>
            <strong>Evidence in chat.</strong>{" "}After deploying, the
            conversation records what was deployed and the verified result,
            so there&apos;s never ambiguity about what went live.
          </>,
        ]}
      />

      <DocH2 id="cli-deploy">Deploying from the CLI</DocH2>
      <DocP>
        From the terminal, <InlineCode>litt deploy verify</InlineCode> watches
        a deployment and verifies production health, and{" "}
        <InlineCode>litt production finish</InlineCode> runs the remaining
        production gates before a release. See{" "}
        <Link
          href="/docs/cli"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Installation & Commands
        </Link>
        .
      </DocP>

      <Callout kind="tip" title="The shipping checklist">
        Before you deploy: preview on desktop and mobile widths, click every
        button and form, and read through the activity timeline once. Five
        minutes of checking beats an embarrassing rollback.
      </Callout>
    </>
  );
}
