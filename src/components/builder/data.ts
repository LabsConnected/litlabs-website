import type { Agent, WorkspaceFile } from "./types";

export const FILES: WorkspaceFile[] = [
  {
    path: "app/studio/builder-shell.tsx",
    name: "builder-shell.tsx",
    language: "typescript",
    status: "modified",
    content: `"use client";

import { useMemo, useState } from "react";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";

export default function BuilderShell() {
  const [layout, setLayout] = useState<"editor" | "split" | "preview">("split");
  const activeFile = useMemo(() => "app/studio/builder-shell.tsx", []);

  return (
    <main className="builder-shell">
      <section data-layout={layout}>
        <PreviewPane />
        <TerminalPanel />
      </section>
    </main>
  );
}`,
  },
  {
    path: "components/terminal/TerminalPanel.tsx",
    name: "TerminalPanel.tsx",
    language: "typescript",
    status: "modified",
    content: `"use client";

import { useEffect, useRef } from "react";

export function TerminalPanel() {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Connect xterm.js to the authenticated workspace bridge.
  }, []);

  return <div ref={terminalRef} className="terminal" />;
}`,
  },
  {
    path: "components/preview/PreviewPane.tsx",
    name: "PreviewPane.tsx",
    language: "typescript",
    status: "added",
    content: `export function PreviewPane() {
  return (
    <iframe
      title="Live preview"
      sandbox="allow-scripts allow-forms allow-modals"
      src="http://localhost:3000"
    />
  );
}`,
  },
  {
    path: "app/studio/page.tsx",
    name: "page.tsx",
    language: "typescript",
    status: "clean",
    content: `import BuilderShell from "@/components/builder/BuilderShell";

export default function StudioPage() {
  return <BuilderShell />;
}`,
  },
];

export const AGENTS: Agent[] = [
  { id: "litt", name: "LiTT AI", role: "Workspace Director", status: "online", progress: 100, accent: "#6b63ff" },
  { id: "code", name: "LiTT-Code", role: "Engineer & Architect", status: "working", progress: 68, accent: "#2ce7ff" },
  { id: "render", name: "Render Agent", role: "Video & Image Pipeline", status: "busy", progress: 78, accent: "#ff9b42" },
  { id: "ui", name: "UI Designer", role: "Interface Specialist", status: "working", progress: 45, accent: "#bd55ff" },
  { id: "qa", name: "QA Goblin", role: "Testing & Review", status: "idle", progress: 28, accent: "#46ffa2" },
];

export const PREVIEW_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
*{box-sizing:border-box}body{margin:0;background:#060716;color:#fff;font-family:Inter,system-ui;min-height:100vh;overflow:hidden}.wrap{min-height:100vh;padding:40px;background:radial-gradient(circle at 72% 18%,rgba(132,52,255,.35),transparent 26%),radial-gradient(circle at 80% 70%,rgba(0,235,255,.14),transparent 26%),linear-gradient(145deg,#050713,#0c1021 60%,#080615)}.nav{display:flex;justify-content:space-between;align-items:center;font-weight:800}.brand{display:flex;gap:10px;align-items:center}.mark{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#9a42ff,#24eaff);box-shadow:0 0 22px #7d3cff88}.menu{opacity:.65}.hero{max-width:720px;margin:100px auto 0;text-align:center}.eyebrow{color:#43ffc0;font-size:12px;text-transform:uppercase;letter-spacing:.18em}.hero h1{font-size:58px;line-height:1.02;margin:18px 0}.grad{background:linear-gradient(90deg,#fff,#c35cff,#28eaff);-webkit-background-clip:text;color:transparent}.hero p{color:#a7afc5;line-height:1.7}.actions{display:flex;gap:12px;justify-content:center;margin-top:30px}.btn{padding:13px 19px;border-radius:11px;border:1px solid #ffffff18;background:#ffffff0a;color:#fff}.primary{background:linear-gradient(135deg,#8537ff,#b43cff);box-shadow:0 14px 36px #8134ff44}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:55px auto 0;max-width:760px}.card{padding:18px;border:1px solid #ffffff13;background:#0b1021b8;border-radius:14px;text-align:left}.card b{display:block;margin-bottom:7px}.card span{color:#8793ad;font-size:13px}@media(max-width:700px){.wrap{padding:22px}.hero{margin-top:70px}.hero h1{font-size:40px}.cards{grid-template-columns:1fr}.menu{display:none}}
</style>
</head>
<body><div class="wrap"><div class="nav"><div class="brand"><i class="mark"></i>LiTTreeLabStudios</div><div class="menu">Studio · Agents · Gallery</div></div><main class="hero"><div class="eyebrow">One command away</div><h1>Build. Create. Automate.<br/><span class="grad">All in one AI platform.</span></h1><p>Code, media, agents, terminal, preview and deployment inside one focused workspace.</p><div class="actions"><button class="btn primary">Launch Studio</button><button class="btn">See features</button></div></main><section class="cards"><div class="card"><b>AI Builder</b><span>Plan, edit, test and ship.</span></div><div class="card"><b>Media Studio</b><span>Image, video and audio workflows.</span></div><div class="card"><b>Agent Swarm</b><span>Specialists working together.</span></div></section></div></body></html>`;
