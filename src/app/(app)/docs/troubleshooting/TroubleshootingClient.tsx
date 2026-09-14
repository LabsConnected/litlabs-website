"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import {
  DocH1,
  DocH2,
  DocIntro,
  DocP,
  InlineCode,
  Callout,
  TermList,
} from "../_components/DocPrimitives";

export default function TroubleshootingClient() {
  const { resolvedColors: T } = useTheme();

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className="font-bold underline decoration-dotted underline-offset-4"
      style={{ color: T.accentColor }}
    >
      {label}
    </Link>
  );

  return (
    <>
      <p
        className="mb-3 text-xs font-bold uppercase tracking-[0.28em]"
        style={{ color: T.accentColor }}
      >
        Help
      </p>
      <DocH1>Troubleshooting</DocH1>
      <DocIntro>
        Real fixes for the issues you&apos;re most likely to hit at launch.
        Start at the top — most problems are one of these.
      </DocIntro>

      <DocH2 id="preview-not-starting">Preview not starting</DocH2>
      <TermList
        terms={[
          {
            term: "Wait for “Preparing preview…”",
            definition:
              "The first start provisions the workspace and can take a little while. Give it time before assuming it's stuck.",
          },
          {
            term: "Use Retry / Restart preview",
            definition:
              "If the panel reports the runtime is unreachable or failed to start, the Retry button (or Restart preview after a failure) kicks off a fresh start. Retrying is safe — it won't duplicate your project or lose files.",
          },
          {
            term: "Check the terminal",
            definition:
              "Open the Terminal drawer and look for error output from the dev server — a missing dependency or a port conflict usually shows up there first.",
          },
          {
            term: "Ask LiTT",
            definition:
              "Paste what you see into chat: “the preview won't start — here's what the panel says: …”. LiTT can inspect the workspace and fix the underlying issue.",
          },
        ]}
      />

      <DocH2 id="terminal-disconnected">Terminal disconnected</DocH2>
      <DocP>
        If the terminal shows as disconnected or never starts, open the{" "}
        <strong>Terminal</strong> drawer and reconnect it from there. LiTT
        needs a connected terminal to install dependencies, run builds, and
        execute commands — without it, build steps will stall. If
        reconnecting fails repeatedly, refresh the page: Studio
        re-establishes the session and your files are safe.
      </DocP>

      <DocH2 id="deployment-approval">Deployment waiting for approval</DocH2>
      <DocP>
        If a deployment seems stuck, check whether it&apos;s waiting on you:
        deploying is a consequential action, so Studio may be holding for
        your approval. Look for the approval prompt in the conversation or
        header, approve it, and the deploy proceeds. Declining or ignoring
        it leaves everything exactly as it was — nothing publishes halfway.
        See {link("/docs/safety", "Safety & Approvals")}.
      </DocP>

      <DocH2 id="model-failure">Model or provider failure</DocH2>
      <DocP>
        If LiTT reports that a model or provider failed, it will tell you
        what happened rather than silently degrading. Your options:
      </DocP>
      <TermList
        terms={[
          {
            term: "Check provider health",
            definition:
              "Open the agent/model selector in the composer — each provider shows live health: available, degraded, or locked.",
          },
          {
            term: "Switch models",
            definition:
              "Pick a different model from the selector, or switch to LiTT Auto and let it route around the problem.",
          },
          {
            term: "Retry the message",
            definition:
              "Provider hiccups are often transient. Resend the message before assuming something is broken.",
          },
        ]}
      />

      <DocH2 id="project-not-loaded">Project not loaded</DocH2>
      <DocP>
        If Studio looks empty — no files, no preview, chat with no context —
        no project is active. Select a project to make it active; chat,
        preview, and terminal all follow the active project. Creating a new
        project from a template is the fastest way to get back to a working
        state.
      </DocP>

      <DocH2 id="refresh-recovery">Refresh & recovery</DocH2>
      <DocP>
        Refreshing the page is safe: your project files are saved, and
        Studio re-establishes the chat session, preview, and terminal
        connection on reload. If the UI ever gets into a weird state — a
        stuck spinner, a panel that won&apos;t update — a refresh is a
        legitimate first fix, not a workaround.
      </DocP>

      <DocH2 id="cli-connectivity">CLI connectivity issues</DocH2>
      <TermList
        terms={[
          {
            term: <InlineCode>litt doctor</InlineCode>,
            definition:
              "Run this first. It checks environment, auth, network, project setup, and provider availability in one report.",
          },
          {
            term: "Remote commands fail",
            definition: (
              <>
                <InlineCode>--remote</InlineCode> work needs the terminal
                server to be reachable. Confirm you&apos;re signed in (
                <InlineCode>litt whoami</InlineCode>) and not forcing{" "}
                <InlineCode>LITT_LOCAL_ONLY=1</InlineCode>.
              </>
            ),
          },
          {
            term: "Wrong workspace",
            definition: (
              <>
                <InlineCode>litt workspace current</InlineCode> shows the
                selected workspace; <InlineCode>litt workspace select</InlineCode>{" "}
                switches it.
              </>
            ),
          },
        ]}
      />

      <Callout kind="note" title="Still stuck?">
        Email{" "}
        <a
          href="mailto:support@litlabs.net"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          support@litlabs.net
        </a>{" "}
        with what you were doing, what you expected, and what you saw
        instead — including any error text. The activity timeline and
        terminal output are the most useful things you can include.
      </Callout>
    </>
  );
}
