"use client";

import { useEffect, useState } from "react";
import {
  GitBranch,
  Database,
  Bot,
  Terminal,
  Rocket,
  Plug,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

export type ConnectorStatus = "connected" | "disconnected" | "loading" | "error";

export type Connector = {
  id: string;
  label: string;
  icon: typeof GitBranch;
  href?: string;
  status: ConnectorStatus;
};

function ConnectorPill({
  connector,
}: {
  connector: Connector;
}) {
  const Icon = connector.icon;
  const statusIcon =
    connector.status === "connected" ? (
      <CheckCircle2 size={10} className="text-green-400" />
    ) : connector.status === "loading" ? (
      <Loader2 size={10} className="animate-spin text-amber-400" />
    ) : connector.status === "error" ? (
      <AlertCircle size={10} className="text-red-400" />
    ) : (
      <Plug size={10} className="text-neutral-500" />
    );

  const label = `${connector.label}`;
  const body = (
    <>
      <Icon size={12} className="text-cyan-300" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{connector.label.split(" ")[0]}</span>
      {statusIcon}
    </>
  );

  const className =
    "flex items-center gap-1.5 rounded-full border border-neutral-700/50 bg-neutral-900/60 px-2 py-1 text-[10px] font-bold text-neutral-300 transition hover:border-cyan-500/30 hover:bg-neutral-800/60 hover:text-cyan-200";

  if (connector.href) {
    return (
      <a href={connector.href} className={className}>
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}

export function ConnectorStrip({ connected }: { connected: boolean }) {
  const [githubStatus, setGithubStatus] = useState<ConnectorStatus>("loading");
  const [memoryStatus, setMemoryStatus] = useState<ConnectorStatus>("loading");

  useEffect(() => {
    let alive = true;
    fetch("/api/github/installations")
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const hasInstall = Array.isArray(data?.installations) && data.installations.length > 0;
        setGithubStatus(hasInstall ? "connected" : "disconnected");
      })
      .catch(() => {
        if (!alive) return;
        setGithubStatus("error");
      });

    fetch("/api/memory")
      .then((r) => {
        if (!alive) return;
        setMemoryStatus(r.ok ? "connected" : "error");
      })
      .catch(() => {
        if (!alive) return;
        setMemoryStatus("error");
      });

    return () => {
      alive = false;
    };
  }, []);

  const connectors: Connector[] = [
    {
      id: "github",
      label: "GitHub",
      icon: GitBranch,
      href: "/settings?tab=integrations",
      status: githubStatus,
    },
    {
      id: "memory",
      label: "Memory",
      icon: Database,
      href: "/agents/me?tab=memory",
      status: memoryStatus,
    },
    {
      id: "agents",
      label: "Agents",
      icon: Bot,
      href: "/agents",
      status: "connected",
    },
    {
      id: "terminal",
      label: "Terminal",
      icon: Terminal,
      status: connected ? "connected" : "disconnected",
    },
    {
      id: "deploy",
      label: "Deploy",
      icon: Rocket,
      status: "connected",
    },
  ];

  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-1">
      {connectors.map((c) => (
        <ConnectorPill key={c.id} connector={c} />
      ))}
    </div>
  );
}
