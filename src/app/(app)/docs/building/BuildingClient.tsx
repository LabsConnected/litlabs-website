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
  ExamplePrompt,
  Steps,
} from "../_components/DocPrimitives";

export default function BuildingClient() {
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
      <DocH1>Building with LiTT</DocH1>
      <DocIntro>
        Building with LiTT is a conversation with a tight feedback loop:
        describe what you want, watch LiTT build it, check the preview, and
        iterate. Here are real prompts that work — and the loop that ties
        them together.
      </DocIntro>

      <DocH2 id="the-loop">The loop: build → verify → preview → deploy</DocH2>
      <Steps
        steps={[
          {
            title: "Build",
            body: (
              <>
                You send a mission in chat. LiTT plans the work, edits real
                project files, and runs terminal commands — installing
                packages, building, and testing as needed.
              </>
            ),
          },
          {
            title: "Verify",
            body: (
              <>
                LiTT runs checks against the work: typechecks, linters, tests,
                or a build step, depending on the project. If something fails,
                LiTT sees the error and fixes it — you&apos;ll see the retry
                in the activity timeline.
              </>
            ),
          },
          {
            title: "Preview",
            body: (
              <>
                You open the <strong>Preview</strong> tab and click through
                the running project. This is the moment of truth: does it
                look right, does it behave right?
              </>
            ),
          },
          {
            title: "Deploy",
            body: (
              <>
                When the preview looks right, the{" "}
                <strong>Deploy</strong> action prepares the project to go
                live. Deployment may ask for your approval first — nothing
                ships without you.
              </>
            ),
          },
        ]}
      />
      <DocP>
        Then the loop repeats: every follow-up message — “make the headline
        bigger,” “add a pricing section” — goes through build → verify →
        preview again. Small loops beat big-bang requests: ten short
        iterations land better than one enormous prompt.
      </DocP>

      <DocH2 id="examples">Example prompts that work</DocH2>
      <DocP>
        Copy these patterns and adapt them. The formula is simple:{" "}
        <strong>what it is</strong> + <strong>who it&apos;s for</strong> +{" "}
        <strong>what it must include</strong>.
      </DocP>

      <ExamplePrompt caption="Start a project">
        Build me a landing page for my coffee shop, Ember Roast. Dark,
        premium design. Hero with our story, a menu section with prices, a
        photo gallery, and a contact section with our address and hours.
      </ExamplePrompt>

      <ExamplePrompt caption="Change something">
        Change the hero headline to “Roasted in Michigan, poured with love”
        and swap the hero image for something warmer.
      </ExamplePrompt>

      <ExamplePrompt caption="Add a section">
        Add a testimonials section below the menu with three customer quotes
        and star ratings.
      </ExamplePrompt>

      <ExamplePrompt caption="Fix a problem">
        The contact form doesn&apos;t submit — when I click Send nothing
        happens. Fix it and show me what was wrong.
      </ExamplePrompt>

      <ExamplePrompt caption="Ask for verification">
        Preview it and check that the site works on mobile — make sure
        nothing overflows horizontally and the menu is reachable.
      </ExamplePrompt>

      <ExamplePrompt caption="Ship it">
        This looks good. Deploy it.
      </ExamplePrompt>

      <DocH2 id="good-missions">What makes a good mission</DocH2>
      <DocList
        items={[
          <>
            <strong>Be concrete about the outcome.</strong> “A landing page
            for my bakery with a menu and contact form” beats “make me a
            website.”
          </>,
          <>
            <strong>Name the audience and the vibe.</strong> “For busy
            parents, clean and calm” gives LiTT design direction it
            can&apos;t guess.
          </>,
          <>
            <strong>List must-haves.</strong> Sections, pages, or features
            you know you need — LiTT fills in the rest.
          </>,
          <>
            <strong>One mission, one outcome.</strong> “Build the landing
            page” first; “now add a blog” second. Short loops, better
            results.
          </>,
          <>
            <strong>Point at problems precisely.</strong> “The menu overlaps
            the hero on my phone” is actionable; “it looks weird” is a
            guessing game.
          </>,
        ]}
      />

      <DocH2 id="verify-yourself">Verifying LiTT&apos;s work</DocH2>
      <DocP>
        Trust, but verify — LiTT makes it easy:
      </DocP>
      <DocList
        items={[
          <>
            <strong>Preview tab</strong> — click through the running project
            yourself. If it works here, the build is real.
          </>,
          <>
            <strong>Code tab</strong> — read the actual files. Every edit is
            visible; nothing is hidden behind the chat.
          </>,
          <>
            <strong>Activity timeline</strong> — see which files changed and
            which commands ran, in order.
          </>,
          <>
            <strong>Terminal</strong> — run your own checks.{" "}
            <InlineCode>litt check</InlineCode>-style verification from the
            CLI works on the same project files.
          </>,
        ]}
      />
      <Callout kind="warning" title="If LiTT says it's done, check the preview">
        “Done” means LiTT finished its steps — not that the result is
        perfect. The preview is the source of truth. If something&apos;s
        off, describe what you see and LiTT will fix it.
      </Callout>

      <DocH2 id="when-stuck">When LiTT gets stuck</DocH2>
      <DocP>
        If a build error repeats or the preview won&apos;t start:
      </DocP>
      <DocList
        items={[
          <>
            Paste the error into chat: “I&apos;m seeing this error: … — what
            does it mean and how do we fix it?”
          </>,
          <>Ask LiTT to explain its plan before continuing.</>,
          <>
            Check the terminal for the raw output — sometimes the full log
            shows what the summary didn&apos;t.
          </>,
          <>
            As a last resort, ask LiTT to revert the last change and try a
            different approach.
          </>,
        ]}
      />
      <DocP>
        Persistent issues are covered in {link("/docs/troubleshooting", "Troubleshooting")}.
      </DocP>
    </>
  );
}
