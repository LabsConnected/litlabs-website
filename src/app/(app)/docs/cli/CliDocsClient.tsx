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
  CodeBlock,
  Callout,
  TermList,
} from "../_components/DocPrimitives";

/**
 * CLI documentation — every command below is taken from the actual
 * @litlabs1/litt-cli source (packages/litt-cli). Do not add commands here
 * without verifying them in the package first.
 */
export default function CliDocsClient() {
  const { resolvedColors: T } = useTheme();

  return (
    <>
      <p
        className="mb-3 text-xs font-bold uppercase tracking-[0.28em]"
        style={{ color: T.accentColor }}
      >
        CLI
      </p>
      <DocH1>Installation & Commands</DocH1>
      <DocIntro>
        The LiTT CLI brings the AI operator to your terminal: health checks,
        builds, tests, and deployment verification — with the same project
        brain Studio uses.
      </DocIntro>

      <DocH2 id="requirements">Requirements</DocH2>
      <DocList
        items={[
          <>Node.js 22 or later</>,
          <>Git</>,
          <>pnpm is recommended but not required</>,
        ]}
      />

      <DocH2 id="install">Install</DocH2>
      <CodeBlock label="Install globally">
        {`npm install -g @litlabs1/litt-cli
# or
pnpm add -g @litlabs1/litt-cli`}
      </CodeBlock>
      <DocP>Run once without installing:</DocP>
      <CodeBlock label="Try without installing">
        {`npx @litlabs1/litt-cli --version
# or
pnpm dlx @litlabs1/litt-cli --version`}
      </CodeBlock>
      <DocP>Confirm the install:</DocP>
      <CodeBlock label="Verify">{`litt --version`}</CodeBlock>

      <DocH2 id="login">Sign in</DocH2>
      <DocP>
        Signing in connects the CLI to your LiTTree LabStudios account using
        OAuth (Authorization Code + PKCE). It opens your system browser for
        sign-in, then completes automatically — tokens are stored in your OS
        keychain (file fallback on Termux).
      </DocP>
      <CodeBlock label="Authenticate">
        {`litt login       # sign in via browser
litt whoami      # show the signed-in user (never prints tokens)
litt logout      # sign out`}
      </CodeBlock>
      <Callout kind="note" title="Local-first by default">
        LiTT starts in local mode. Use <InlineCode>--remote</InlineCode> to
        connect to the LiTT cloud, or <InlineCode>--local</InlineCode> to
        force local-only operation. Setting{" "}
        <InlineCode>LITT_LOCAL_ONLY=1</InlineCode> blocks remote and model
        use entirely.
      </Callout>

      <DocH2 id="first-run">First run</DocH2>
      <CodeBlock label="Health check">
        {`litt doctor      # diagnose environment, dependencies, auth, providers`}
      </CodeBlock>
      <DocP>
        <InlineCode>litt doctor</InlineCode> checks your Node version, Git,
        pnpm, network, project setup, authentication, and model provider
        availability — run it first whenever something seems off. Then open
        the interactive cockpit:
      </DocP>
      <CodeBlock label="Cockpit">{`litt            # launch the interactive operator cockpit`}</CodeBlock>
      <DocP>
        <InlineCode>litt shell</InlineCode>, <InlineCode>litt cockpit</InlineCode>,
        and <InlineCode>litt tui</InlineCode> are aliases.{" "}
        <InlineCode>litt desktop</InlineCode> launches the desktop GUI app
        instead.
      </DocP>

      <DocH2 id="commands">Commands</DocH2>
      <DocH3>Project workflow</DocH3>
      <TermList
        terms={[
          { term: <InlineCode>litt status</InlineCode>, definition: "Show project and git status." },
          { term: <InlineCode>litt diff</InlineCode>, definition: "Show the project's git diff." },
          { term: <InlineCode>litt check</InlineCode>, definition: "Run typecheck / lint-style checks." },
          { term: <InlineCode>litt test</InlineCode>, definition: "Run the project's tests." },
          { term: <InlineCode>litt build</InlineCode>, definition: "Build the current project." },
          { term: <InlineCode>litt run</InlineCode>, definition: "Run the current project locally, or run a command through the hardened command executor." },
          { term: <InlineCode>litt inspect</InlineCode>, definition: "Deep repo inspection: framework, scripts, and deploy setup." },
          { term: <InlineCode>litt runs</InlineCode>, definition: "List recent runs from the local run store." },
        ]}
      />
      <DocH3>Asking LiTT</DocH3>
      <TermList
        terms={[
          { term: <InlineCode>litt ask</InlineCode>, definition: "Ask LiTT a question about your project." },
          { term: <InlineCode>litt explain</InlineCode>, definition: "Pipe in errors or diffs and get actionable advice." },
        ]}
      />
      <DocH3>Production & deployment</DocH3>
      <TermList
        terms={[
          { term: <InlineCode>litt production doctor</InlineCode>, definition: "Verify all production readiness gates." },
          { term: <InlineCode>litt production finish</InlineCode>, definition: "Orchestrate the remaining production gates for a release." },
          { term: <InlineCode>litt deploy verify</InlineCode>, definition: "Watch a deployment and verify production health." },
          { term: <InlineCode>litt studio acceptance</InlineCode>, definition: "Run Studio pre-flight and owner browser acceptance checks." },
        ]}
      />
      <DocH3>Workspaces</DocH3>
      <TermList
        terms={[
          { term: <InlineCode>litt workspace list</InlineCode>, definition: "Show all ready workspaces for the signed-in user." },
          { term: <InlineCode>litt workspace select</InlineCode>, definition: "Choose a workspace by index, ID, or interactive prompt." },
          { term: <InlineCode>litt workspace current</InlineCode>, definition: "Show the currently selected workspace." },
        ]}
      />
      <DocH3>Stripe (for projects with billing)</DocH3>
      <TermList
        terms={[
          { term: <InlineCode>litt stripe doctor</InlineCode>, definition: "Stripe-specific diagnostics." },
          { term: <InlineCode>litt stripe repair</InlineCode>, definition: "Fix Stripe configuration issues." },
          { term: <InlineCode>litt stripe sandbox</InlineCode>, definition: "Real Stripe test-mode end-to-end checks (never live)." },
        ]}
      />

      <DocH2 id="modes">Permission modes</DocH2>
      <DocP>
        Control how much the CLI does without asking:
      </DocP>
      <CodeBlock label="Permission modes">
        {`litt --mode plan    # plan only, ask before acting
litt --mode act     # act with approvals (default)
litt --mode auto    # proceed autonomously`}
      </CodeBlock>
      <DocP>
        How approvals work across Studio and CLI is covered in{" "}
        <Link
          href="/docs/safety"
          className="font-bold underline decoration-dotted underline-offset-4"
          style={{ color: T.accentColor }}
        >
          Safety & Approvals
        </Link>
        .
      </DocP>

      <DocH2 id="common-workflows">Common workflows</DocH2>
      <DocH3>Verify a project end to end</DocH3>
      <CodeBlock label="Verify">
        {`litt status
litt check
litt test
litt build`}
      </CodeBlock>
      <DocH3>Prepare a production release</DocH3>
      <CodeBlock label="Release">
        {`litt production doctor
litt production finish
litt deploy verify`}
      </CodeBlock>

      <DocH2 id="troubleshooting">CLI troubleshooting</DocH2>
      <TermList
        terms={[
          {
            term: "“Not signed in” on protected commands",
            definition: (
              <>Run <InlineCode>litt login</InlineCode> again. If the browser didn&apos;t open, use <InlineCode>litt login --force</InlineCode> to go through the sign-in screen fresh.</>
            ),
          },
          {
            term: "Remote commands fail to connect",
            definition: (
              <>The CLI needs the terminal server to be reachable for <InlineCode>--remote</InlineCode> work. Run <InlineCode>litt doctor</InlineCode> to check network and auth, and confirm you&apos;re not forcing <InlineCode>LITT_LOCAL_ONLY=1</InlineCode>.</>
            ),
          },
          {
            term: "Wrong workspace",
            definition: (
              <>Use <InlineCode>litt workspace current</InlineCode> to see which workspace is selected, then <InlineCode>litt workspace select</InlineCode> to switch.</>
            ),
          },
          {
            term: "Model/provider errors",
            definition: (
              <><InlineCode>litt doctor</InlineCode> reports model provider availability. If a provider is down, pick a different model — the same health states you see in Studio&apos;s model selector apply here.</>
            ),
          },
          {
            term: "Termux / Android",
            definition: (
              <>The CLI is supported on Termux. Tokens fall back to file storage when the OS keychain isn&apos;t available, and <InlineCode>litt doctor</InlineCode> validates the full environment there too.</>
            ),
          },
        ]}
      />
      <Callout kind="tip" title="Start with doctor">
        <InlineCode>litt doctor</InlineCode> is the fastest path to an
        answer for almost every CLI problem — environment, auth,
        connectivity, and providers in one report.
      </Callout>
    </>
  );
}
