"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { ArrowRight, Mail } from "lucide-react";
import { DOCS_NAV } from "./_components/docs-nav";
import {
  DocH1,
  DocH2,
  DocIntro,
  DocP,
  DocList,
  InlineCode,
  Callout,
  TermList,
} from "./_components/DocPrimitives";

/**
 * /docs — documentation overview. Explains what LiTT is and how the
 * pieces fit together, then routes readers into the detailed guides.
 *
 * Product-action links (Studio, sign-up) still respect sign-in state:
 * signed-out visitors go to the signup funnel instead of bouncing off
 * the Studio login wall.
 */
export default function DocsOverviewClient() {
  const { resolvedColors: T } = useTheme();
  const { isSignedIn, isLoaded } = useClerkAuth();
  const searchParams = useSearchParams();
  const isSupport = searchParams.get("topic") === "support";

  const signedIn = isLoaded && isSignedIn;
  const studioHref = signedIn ? "/studio" : "/sign-up";

  return (
    <>
      <p
        className="mb-3 text-xs font-bold uppercase tracking-[0.28em]"
        style={{ color: T.accentColor }}
      >
        Documentation
      </p>
      <DocH1>What LiTT is</DocH1>
      <DocIntro>
        LiTT is an AI project operator. You describe what you want in plain
        language, and LiTT plans the work, edits real files, runs terminal
        commands, verifies the result, and prepares it to ship. Bring the
        idea — LiTT builds the rest.
      </DocIntro>

      {isSupport && (
        <section
          className="mb-10 rounded-2xl border p-6"
          style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
        >
          <h2 className="mb-2 text-lg font-black" style={{ color: T.headerColor }}>
            Support
          </h2>
          <p className="mb-4 text-sm leading-relaxed opacity-70">
            Need help? Reach out and we&apos;ll get back to you as soon as
            possible.
          </p>
          <a
            href="mailto:support@litlabs.net"
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            <Mail size={14} />
            Email support@litlabs.net
          </a>
        </section>
      )}

      <DocH2 id="how-it-works">How it works</DocH2>
      <DocP>
        Every build follows the same loop — whether you type it into Studio
        chat or run it from the CLI:
      </DocP>
      <DocList
        items={[
          <>
            <strong>Mission</strong> — you describe the outcome in plain
            language: “build me a landing page for my bakery.”
          </>,
          <>
            <strong>Plan</strong> — LiTT breaks the mission into steps you can
            see and adjust.
          </>,
          <>
            <strong>Build</strong> — LiTT edits real project files and runs
            real terminal commands.
          </>,
          <>
            <strong>Verify</strong> — checks, tests, and a live preview confirm
            it actually works.
          </>,
          <>
            <strong>Ship</strong> — with your approval, LiTT prepares the work
            for deployment.
          </>,
        ]}
      />
      <Callout kind="tip" title="Nothing is faked">
        LiTT works on real files in a real project workspace. The preview
        pane shows your actual project running — not a mockup — and the
        terminal runs real commands against it.
      </Callout>

      <DocH2 id="studio">Studio</DocH2>
      <DocP>
        <Link
          href={studioHref}
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Studio
        </Link>{" "}
        is the main workspace. It has three areas:
      </DocP>
      <TermList
        terms={[
          {
            term: "LiTT panel (left)",
            definition:
              "Chat with LiTT and the specialist agents, plus a Live tab that shows what the agent is doing right now.",
          },
          {
            term: "Workspace (center)",
            definition:
              "The working surface with tabs for Plan, Canvas, Code, Preview, and Media. This is where the project takes shape.",
          },
          {
            term: "Tools (right)",
            definition:
              "A contextual panel for Files, Components, Terminal, and the activity timeline — everything LiTT touches, visible.",
          },
        ]}
      />
      <DocP>
        The full tour — every tab, drawer, and control — is in the{" "}
        <Link
          href="/docs/studio"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Studio Guide
        </Link>
        .
      </DocP>

      <DocH2 id="projects">Projects & workspaces</DocH2>
      <DocP>
        A <strong>project</strong> is the thing you are building — a website,
        an app, a campaign. Each project gets its own <strong>workspace</strong>:
        the files, the preview runtime, and a terminal session connected to
        that environment. Create a project from a template or start blank,
        then select it to make it active. Everything in Studio — chat,
        preview, terminal — follows the active project.
      </DocP>

      <DocH2 id="chat-agents">Chat & agents</DocH2>
      <DocP>
        You drive LiTT by chatting. Pick a specialist for the job —{" "}
        <InlineCode>LiTT</InlineCode>, <InlineCode>Spark</InlineCode> (creative),{" "}
        <InlineCode>Coder</InlineCode> (engineering), <InlineCode>Writer</InlineCode>,{" "}
        <InlineCode>Researcher</InlineCode>, <InlineCode>Marketer</InlineCode>,{" "}
        <InlineCode>Analyst</InlineCode>, <InlineCode>Nova</InlineCode>,{" "}
        <InlineCode>Forge</InlineCode>, <InlineCode>Echo</InlineCode> — or use{" "}
        <InlineCode>LiTT Auto</InlineCode>, which routes your request
        automatically. You can also choose the underlying model, including
        your own API keys, with live provider health shown in the selector.
      </DocP>

      <DocH2 id="preview">Preview</DocH2>
      <DocP>
        The <strong>Preview</strong> tab runs your active project so you can
        see and click through it while LiTT works. Preview starts
        automatically for the active project, and if it ever fails to start
        you can retry it from the preview panel. Preview is a working copy
        for iteration — it is not the same as a production deployment. See{" "}
        <Link
          href="/docs/preview-deploy"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Preview & Deployment
        </Link>
        .
      </DocP>

      <DocH2 id="terminal">Terminal</DocH2>
      <DocP>
        Studio includes a real terminal connected to your project&apos;s
        environment. LiTT uses it to install dependencies, run builds and
        tests, and inspect the project — and you can open it yourself any
        time you want to run a command by hand.
      </DocP>

      <DocH2 id="build-edit">Build & edit workflow</DocH2>
      <DocP>
        Building is a conversation, not a form. Describe what you want, watch
        LiTT plan and edit files, check the preview, and keep iterating:
        “change the hero,” “fix this build error,” “make the button bigger.”
        Each round goes through build → verify → preview until it looks
        right. Worked examples are in{" "}
        <Link
          href="/docs/building"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Building with LiTT
        </Link>
        .
      </DocP>

      <DocH2 id="deployment">Deployment</DocH2>
      <DocP>
        When the project is ready, the <strong>Deploy</strong> action in
        Studio prepares it to go live. Publishing is a deliberate step and
        may ask for your approval first — previewing is free and unlimited,
        deploying is the moment you decide the world should see it.
      </DocP>

      <DocH2 id="cli">CLI</DocH2>
      <DocP>
        Prefer the terminal? The <strong>LiTT CLI</strong> (
        <InlineCode>@litlabs1/litt-cli</InlineCode>) brings the same
        operator to your command line: health checks, builds, tests, and
        deployment verification. See{" "}
        <Link
          href="/docs/cli"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Installation & Commands
        </Link>
        .
      </DocP>

      <DocH2 id="marketplace">Marketplace</DocH2>
      <DocP>
        The{" "}
        <Link
          href="/marketplace"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Marketplace
        </Link>{" "}
        offers specialist agents you can install into your workspace — for
        code review, content, support, analytics, and more. Installing
        requires an account. Details in{" "}
        <Link
          href="/docs/marketplace"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Marketplace
        </Link>
        .
      </DocP>

      <DocH2 id="safety">Approvals & safety</DocH2>
      <DocP>
        LiTT asks for your approval before consequential actions like
        deploying or publishing. In the CLI you can also set a permission
        mode — <InlineCode>plan</InlineCode>, <InlineCode>act</InlineCode>, or{" "}
        <InlineCode>auto</InlineCode> — to control how much runs without
        asking. How it all works is covered in{" "}
        <Link
          href="/docs/safety"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Safety & Approvals
        </Link>
        .
      </DocP>

      <DocH2 id="guides">Guides</DocH2>
      <DocP>
        Pick where to go next — or start at the beginning with the{" "}
        <Link
          href="/docs/quick-start"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Quick Start
        </Link>
        .
      </DocP>
      <div className="grid gap-4 md:grid-cols-2" data-testid="docs-guide-cards">
        {DOCS_NAV.flatMap((group) =>
          group.pages
            .filter((page) => page.href !== "/docs")
            .map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="group rounded-2xl border p-6 transition-all hover:-translate-y-1"
                style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
              >
                <h3
                  className="mb-2 text-base font-black"
                  style={{ color: T.headerColor }}
                >
                  {page.title}
                </h3>
                <p
                  className="mb-4 text-sm leading-relaxed opacity-60"
                  style={{ color: T.textColor }}
                >
                  {page.description}
                </p>
                <span
                  className="inline-flex items-center gap-2 text-sm font-bold"
                  style={{ color: T.accentColor }}
                >
                  Read{" "}
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </span>
              </Link>
            )),
        )}
      </div>
    </>
  );
}
