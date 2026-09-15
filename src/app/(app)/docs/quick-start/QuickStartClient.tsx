"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  DocH1,
  DocH2,
  DocIntro,
  DocP,
  InlineCode,
  Callout,
  Steps,
  ExamplePrompt,
  CodeBlock,
} from "../_components/DocPrimitives";

export default function QuickStartClient() {
  const { resolvedColors: T } = useTheme();
  const { isSignedIn, isLoaded } = useClerkAuth();
  const signedIn = isLoaded && isSignedIn;
  const studioHref = signedIn ? "/studio" : "/sign-up";

  return (
    <>
      <p
        className="mb-3 text-xs font-bold uppercase tracking-[0.28em]"
        style={{ color: T.accentColor }}
      >
        Getting Started
      </p>
      <DocH1>Quick Start</DocH1>
      <DocIntro>
        Go from a blank account to a live preview of your first project in
        about ten minutes. You don&apos;t need to know how to code — you
        just need an idea.
      </DocIntro>

      <Steps
        steps={[
          {
            title: "Create your account",
            body: (
              <>
                Head to{" "}
                <Link
                  href="/sign-up"
                  className="font-bold underline decoration-dotted underline-offset-4"
                  style={{ color: T.accentColor }}
                >
                  sign-up
                </Link>{" "}
                and create your LiTTree LabStudios account. This gives you
                access to Studio, projects, and the marketplace.
              </>
            ),
          },
          {
            title: "Open Studio",
            body: (
              <>
                After signing in, open{" "}
                <Link
                  href={studioHref}
                  className="font-bold underline decoration-dotted underline-offset-4"
                  style={{ color: T.accentColor }}
                >
                  Studio
                </Link>
                . This is your workspace: LiTT chat on the left, the project
                workspace in the center, and tools on the right.
              </>
            ),
          },
          {
            title: "Create or select a project",
            body: (
              <>
                Start a new project from a template (a website template is the
                fastest way to see results) or start blank. Your project gets
                its own workspace — files, a preview runtime, and a terminal
                session. The active project is the one everything in Studio
                follows.
              </>
            ),
          },
          {
            title: "Tell LiTT what to build",
            body: (
              <>
                Type your idea into the chat in plain language. Be specific
                about what it is and who it&apos;s for — LiTT turns that into
                a plan and starts building.
                <div className="mt-3">
                  <ExamplePrompt caption="Try this">
                    Build me a landing page for my bakery, &quot;Crumb &amp;
                    Craft&quot;. Warm colors, a hero with our sourdough, a
                    menu section, and a contact form.
                  </ExamplePrompt>
                </div>
              </>
            ),
          },
          {
            title: "Inspect the files",
            body: (
              <>
                Open the <strong>Files</strong> panel to see what LiTT
                created — real files like <InlineCode>index.html</InlineCode>,
                stylesheets, and scripts. Switch to the{" "}
                <strong>Code</strong> tab to read and review them. Nothing is
                hidden: every edit LiTT makes is visible in your project.
              </>
            ),
          },
          {
            title: "Preview the project",
            body: (
              <>
                Switch to the <strong>Preview</strong> tab. LiTT starts a live
                preview of your project automatically — this is your actual
                project running, not a mockup. Click through it the way a
                visitor would.
              </>
            ),
          },
          {
            title: "Iterate through chat",
            body: (
              <>
                See something to change? Just say so. Each round goes through
                build → verify → preview until it looks right.
                <div className="mt-3">
                  <ExamplePrompt caption="Try this">
                    Change the hero headline to &quot;Baked at dawn, gone by
                    noon&quot; and make the order button bigger.
                  </ExamplePrompt>
                </div>
              </>
            ),
          },
          {
            title: "Use the terminal when you need it",
            body: (
              <>
                Open the <strong>Terminal</strong> panel any time you want to
                run a command yourself — installing a package, checking a
                build, or inspecting files. LiTT uses the same terminal for
                its own work, so you always see what ran.
              </>
            ),
          },
          {
            title: "Deploy it",
            body: (
              <>
                Happy with the preview? Use the <strong>Deploy</strong> action
                in Studio to prepare the project to go live. Deployment is a
                deliberate step and may ask for your approval first — nothing
                ships without you saying so.
              </>
            ),
          },
          {
            title: "Verify the result",
            body: (
              <>
                Open the live URL, click through the site, and confirm
                everything works. If something&apos;s off, go back to chat —
                “the contact form doesn&apos;t submit” — and iterate again.
                That loop is the whole product.
              </>
            ),
          },
        ]}
      />

      <DocH2 id="first-project-tips">Tips for your first project</DocH2>
      <Callout kind="tip" title="Start small, then grow">
        Your first mission doesn&apos;t need to be the final product. “A
        one-page site for my bakery” is a perfect first build — you can add
        pages, forms, and features in follow-up messages once the basics are
        live.
      </Callout>
      <Callout kind="note" title="Preview is free, deployment is deliberate">
        Iterate in the preview as much as you like — it costs nothing and
        nothing is public. Only the Deploy step puts the project in front of
        the world, and it asks for your approval first.
      </Callout>

      <DocH2 id="command-line">Prefer the command line?</DocH2>
      <DocP>
        The same workflow works from your terminal with the LiTT CLI:
      </DocP>
      <CodeBlock label="Terminal">
        {`npm install -g @litlabs1/litt-cli
litt login
litt doctor`}
      </CodeBlock>
      <DocP>
        Full command reference in{" "}
        <Link
          href="/docs/cli"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Installation & Commands
        </Link>
        .
      </DocP>

      <DocH2 id="next">What&apos;s next</DocH2>
      <DocP>
        Now that you&apos;ve shipped once, learn the workspace in depth with
        the{" "}
        <Link
          href="/docs/studio"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Studio Guide
        </Link>
        , or see real example prompts in{" "}
        <Link
          href="/docs/building"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Building with LiTT
        </Link>
        .
      </DocP>
    </>
  );
}
