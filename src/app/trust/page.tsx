import { Shield, Lock, Check, X, GitBranch, Eye, DollarSign, Trash2, Users } from "lucide-react";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trust & Safety — LiTTree Lab Studios",
  description: "What agents can access, what they cannot, approval requirements, project isolation, and data controls.",
};

export default function TrustPage() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-black text-white">Trust & Safety</h1>
        <p className="mt-2 text-sm text-neutral-500">
          LiTT agents work on your behalf, but you stay in control.
        </p>

        {/* What agents can access */}
        <Section icon={<Check className="h-5 w-5 text-green-400" />} title="What agents can access">
          <ul className="space-y-2 text-sm text-neutral-300">
            <li>Read project files and configuration</li>
            <li>Write project files (after your approval)</li>
            <li>Create Git checkpoints for rollback</li>
            <li>Run build and test commands</li>
            <li>Start preview servers</li>
            <li>Trigger deployments (after your approval)</li>
            <li>Read deployment status from providers</li>
          </ul>
        </Section>

        {/* What agents cannot access */}
        <Section icon={<X className="h-5 w-5 text-red-400" />} title="What agents cannot access">
          <ul className="space-y-2 text-sm text-neutral-300">
            <li>Arbitrary terminal commands</li>
            <li>Environment variables</li>
            <li>Secrets or API keys</li>
            <li>Another user&apos;s project</li>
            <li>Billing or payment settings</li>
            <li>Marketplace purchases</li>
            <li>User impersonation</li>
            <li>Project deletion</li>
          </ul>
        </Section>

        {/* Approval requirements */}
        <Section icon={<Shield className="h-5 w-5 text-amber-400" />} title="Approval requirements">
          <p className="mb-3 text-sm text-neutral-300">
            Every mutation requires your explicit approval. The agent pauses and waits.
          </p>
          <div className="space-y-2">
            <ApprovalRow action="Write files" requirement="Plan approval required" />
            <ApprovalRow action="Create checkpoint" requirement="Plan approval required" />
            <ApprovalRow action="Trigger deployment" requirement="Deploy approval required" />
            <ApprovalRow action="Read files" requirement="No approval needed" auto />
            <ApprovalRow action="Run build" requirement="No approval needed" auto />
            <ApprovalRow action="Start preview" requirement="No approval needed" auto />
          </div>
        </Section>

        {/* Project isolation */}
        <Section icon={<Users className="h-5 w-5 text-cyan-400" />} title="Project isolation">
          <p className="text-sm text-neutral-300">
            Your projects are isolated. An agent working on your project cannot access
            another user&apos;s projects, files, or deployment history. All queries are
            scoped to your user ID.
          </p>
        </Section>

        {/* Checkpoints and rollback */}
        <Section icon={<GitBranch className="h-5 w-5 text-green-400" />} title="Checkpoints and rollback">
          <p className="text-sm text-neutral-300">
            Before any changes are made, the agent creates a Git checkpoint. If something
            goes wrong, you can roll back to the pre-build state. Checkpoints are preserved
            even on failure.
          </p>
        </Section>

        {/* Secret handling */}
        <Section icon={<Lock className="h-5 w-5 text-neutral-400" />} title="Secret handling">
          <p className="text-sm text-neutral-300">
            Agents never see your secrets. Environment variables, API keys, and tokens are
            not accessible to agents. Error messages are sanitized before storage to ensure
            no secrets leak into logs or deployment records.
          </p>
        </Section>

        {/* Billing controls */}
        <Section icon={<DollarSign className="h-5 w-5 text-green-400" />} title="Billing controls">
          <p className="text-sm text-neutral-300">
            You pay once per agent. There are no surprise charges. If an agent fails to
            complete its task, you may be eligible for a refund. Failed deployments do not
            incur success-based usage charges.
          </p>
        </Section>

        {/* Data deletion */}
        <Section icon={<Trash2 className="h-5 w-5 text-red-400" />} title="Data deletion">
          <p className="text-sm text-neutral-300">
            You can delete your projects and data at any time. Agent run history,
            deployments, and associated files are removed when you delete a project.
          </p>
        </Section>

        {/* Human support */}
        <Section icon={<Eye className="h-5 w-5 text-cyan-400" />} title="Human support">
          <p className="text-sm text-neutral-300">
            If something goes wrong, email support is available within 24 hours.
            Every agent run has a durable receipt with timeline, approvals, tool calls,
            and errors that support can review.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-10 border-t border-neutral-800 pt-8">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

function ApprovalRow({ action, requirement, auto }: { action: string; requirement: string; auto?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm">
      <span className="text-neutral-300">{action}</span>
      <span className={auto ? "text-xs text-green-400" : "text-xs text-amber-400"}>{requirement}</span>
    </div>
  );
}
