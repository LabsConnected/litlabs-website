"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import {
  DocH1,
  DocH2,
  DocH3,
  DocIntro,
  DocP,
  DocList,
  InlineCode,
  Callout,
  TermList,
} from "../_components/DocPrimitives";

export default function StudioGuideClient() {
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
        Studio
      </p>
      <DocH1>Studio Guide</DocH1>
      <DocIntro>
        Studio is where you and LiTT build together. Three areas — the LiTT
        panel, the workspace, and the tools panel — stay in sync around one
        active project.
      </DocIntro>

      <DocH2 id="layout">The three areas</DocH2>
      <TermList
        terms={[
          {
            term: "LiTT panel (left)",
            definition:
              "Your conversation with LiTT. The Chat tab is where you type missions and follow-ups; the Live tab shows what the agent is doing right now — which step it's on and what it's touching.",
          },
          {
            term: "Workspace (center)",
            definition:
              "The main working surface, organized into tabs: Plan, Canvas, Code, Preview, and Media. This is where the project takes visible shape.",
          },
          {
            term: "Tools (right)",
            definition:
              "Contextual panels: Files and Components for browsing the project, Terminal for running commands, and the activity timeline showing everything that has happened.",
          },
        ]}
      />
      <Callout kind="note" title="One active project">
        Everything in Studio follows the active project — chat, preview, and
        terminal all operate on the same project. Switch projects and all
        three areas switch with it.
      </Callout>

      <DocH2 id="chat">LiTT chat</DocH2>
      <DocP>
        Chat is the primary control surface. You describe outcomes in plain
        language; LiTT responds with plans, file edits, terminal commands,
        and verification. Conversations are kept per project, so you can pick
        up where you left off.
      </DocP>
      <DocH3>Choosing who you talk to</DocH3>
      <DocP>
        The composer has a selector with two sections — agents and models:
      </DocP>
      <DocList
        items={[
          <>
            <strong>LiTT Auto</strong> — autonomous mode. Describe the goal
            and LiTT routes the work automatically. Start here if you&apos;re
            not sure which specialist to pick.
          </>,
          <>
            <strong>Specialists</strong> — <InlineCode>LiTT</InlineCode> (your
            main operator), <InlineCode>Spark</InlineCode> (creative companion
            and designer), <InlineCode>Coder</InlineCode> (engineering and
            implementation), <InlineCode>Writer</InlineCode> (content and
            copy), <InlineCode>Researcher</InlineCode> (research and
            synthesis), <InlineCode>Marketer</InlineCode> (marketing and
            growth), <InlineCode>Analyst</InlineCode> (data and analytics),{" "}
            <InlineCode>Nova</InlineCode> (business partner),{" "}
            <InlineCode>Forge</InlineCode> (technical partner),{" "}
            <InlineCode>Echo</InlineCode> (creative partner).
          </>,
          <>
            <strong>Models</strong> — pick the underlying model for the
            conversation, including your own API keys. Each provider shows
            live health: available, degraded, or locked.
          </>,
        ]}
      />
      <DocP>
        If a model or provider fails mid-conversation, Studio tells you what
        happened instead of silently degrading — see {link("/docs/troubleshooting", "Troubleshooting")}.
      </DocP>

      <DocH2 id="plan">Plan</DocH2>
      <DocP>
        Before building, LiTT lays out the steps it intends to take. The{" "}
        <strong>Plan</strong> tab shows that breakdown — what will be
        created, changed, and verified. Review it, ask for changes, or let
        LiTT proceed. Big missions go smoother when the plan is right, so
        this is the cheapest place to steer.
      </DocP>

      <DocH2 id="canvas">Canvas</DocH2>
      <DocP>
        <strong>Canvas</strong> is the visual working surface — a place to
        arrange ideas, mock up layouts, and explore directions visually
        before they become files. Use it when you&apos;re thinking in
        pictures rather than code.
      </DocP>

      <DocH2 id="code">Code</DocH2>
      <DocP>
        The <strong>Code</strong> tab shows your project&apos;s actual files.
        Every edit LiTT makes lands here as a real file change you can read,
        and you can switch between a file tree, an editor view, and an app
        preview of the running project. If you know how to code, this is
        where you audit exactly what the agent did.
      </DocP>

      <DocH2 id="preview">Preview</DocH2>
      <DocP>
        <strong>Preview</strong> runs the active project so you can see and
        interact with it. Studio mounts exactly one preview per active
        project — it starts automatically, and if it ever fails to start the
        preview panel offers a retry. Preview is your iteration sandbox: it
        is not the same as a production deployment. Full details in{" "}
        {link("/docs/preview-deploy", "Preview & Deployment")}.
      </DocP>

      <DocH2 id="media">Media</DocH2>
      <DocP>
        <strong>Media</strong> collects what LiTT generates for the project:
        images, video, music, and audio artifacts. Anything created during
        the build — a hero image, a product video, a jingle — shows up here,
        ready to use in the project or download.
      </DocP>

      <DocH2 id="files">Files & Components</DocH2>
      <DocP>
        The <strong>Files</strong> drawer browses the project&apos;s file
        tree — everything LiTT created or changed, organized the way a
        developer would expect. <strong>Components</strong> surfaces the
        reusable pieces. Together they answer “what is actually in my
        project right now?”
      </DocP>

      <DocH2 id="terminal">Terminal</DocH2>
      <DocP>
        The <strong>Terminal</strong> drawer is a real terminal connected to
        your project&apos;s environment. LiTT uses it to install
        dependencies, run builds and tests, and inspect the project — every
        command is visible to you. You can also type your own commands any
        time: installing a package, running a script, or checking what
        changed. If the terminal shows as disconnected, reconnect it from
        the drawer — see {link("/docs/troubleshooting", "Troubleshooting")}.
      </DocP>

      <DocH2 id="activity">Activity</DocH2>
      <DocP>
        The <strong>activity timeline</strong> is the project&apos;s log:
        missions sent, plans made, files edited, commands run, previews
        started, deployments prepared. When something surprises you, the
        timeline shows exactly what led to it.
      </DocP>

      <DocH2 id="deploy-button">The Deploy button</DocH2>
      <DocP>
        The <strong>Deploy</strong> button in the Studio header opens the
        preview/deploy flow for the active project. Deploying is the
        deliberate step that prepares your project to go live — and it may
        ask for your approval before anything publishes. What “deployed”
        means, and how it differs from preview, is covered in{" "}
        {link("/docs/preview-deploy", "Preview & Deployment")}.
      </DocP>

      <DocH2 id="mobile">Studio on mobile</DocH2>
      <DocP>
        On smaller screens Studio collapses into the same three areas with
        the LiTT panel available as an overlay sheet. All the same tabs —
        Plan, Canvas, Code, Preview, Media — and the terminal drawer work the
        same way; only the layout adapts.
      </DocP>

      <Callout kind="tip" title="Learn by doing">
        The fastest way to learn Studio is the{" "}
        <Link
          href="/docs/quick-start"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Quick Start
        </Link>
        : build one small project end to end and you&apos;ll have touched
        every area on this page.
      </Callout>
    </>
  );
}
