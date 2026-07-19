"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  Network,
  AppWindow,
  Bell,
  Bot,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  Command,
  ExternalLink,
  File,
  FileCode2,
  Files,
  Folder,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Globe2,
  Hammer,
  Image as ImageIcon,
  LayoutDashboard,
  Mic,
  MoreHorizontal,
  Package,
  Play,
  Plus,
  Rocket,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Store,
  TestTube2,
  Undo2,
  Users,
  Video,
  WandSparkles,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ComponentProps } from "react";
import TerminalPane from "./TerminalPane";
import { AGENTS, FILES, PREVIEW_HTML } from "./data";
import type { BottomTab, WorkspaceMode } from "./types";
import styles from "./builder.module.css";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className={styles.editorLoading}>Loading Monaco editor…</div>,
});

const nav = [
  [LayoutDashboard, "Dashboard"],
  [Hammer, "Studio"],
  [Bot, "Agents"],
  [ImageIcon, "Gallery"],
  [Gamepad2, "Games"],
  [Users, "Social"],
  [Store, "Marketplace"],
  [Settings, "Settings"],
] as const;

const tools = [
  [MessageIcon, "Chat", "command"],
  [Box, "Build", "media"],
  [Code2, "Code", "code"],
  [SquareTerminal, "Terminal", "code"],
  [Files, "Assets", "media"],
  [Workflow, "Workflows", "command"],
] as const;

function MessageIcon(props: ComponentProps<typeof Bot>) {
  return <Bot {...props} />;
}

export default function BuilderShell() {
  const [mode, setMode] = useState<WorkspaceMode>("code");
  const [activePath, setActivePath] = useState(FILES[0].path);
  const [files, setFiles] = useState(FILES);
  const [bottomTab, setBottomTab] = useState<BottomTab>("terminal");
  const [rightOpen, setRightOpen] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [runState, setRunState] = useState<"idle" | "running" | "done">("idle");

  const activeFile = useMemo(
    () => files.find((file) => file.path === activePath) ?? files[0],
    [activePath, files],
  );

  function updateActiveFile(value?: string) {
    setFiles((current) => current.map((file) => file.path === activePath ? { ...file, content: value ?? "", status: "modified" } : file));
  }

  function runBuild() {
    setRunState("running");
    window.setTimeout(() => setRunState("done"), 1500);
  }

  return (
    <main className={styles.appShell}>
      <div className={styles.ambient} />
      <header className={styles.topbar}>
        <div className={styles.brand}><span className={styles.brandMark}>✦</span><strong>LiTT</strong><span>LiTTree LabStudios</span></div>
        <nav className={styles.topnav}>
          {nav.map(([Icon, label]) => <button key={label} className={label === "Studio" ? styles.topnavActive : ""}><Icon size={15} />{label}</button>)}
        </nav>
        <div className={styles.topActions}>
          <button className={styles.iconButton}><Search size={17} /></button>
          <button className={styles.iconButton}><Bell size={17} /><i /></button>
          <button className={styles.creditPill}><Sparkles size={15} />9,999</button>
          <button className={styles.profilePill}><span>LB</span><b>Builder</b><ChevronDown size={14} /></button>
        </div>
      </header>

      <section className={styles.bodyGrid}>
        <aside className={styles.sideRail}>
          <div className={styles.toolButtons}>
            {tools.map(([Icon, label, nextMode]) => (
              <button key={label} className={mode === nextMode && ((label === "Code" && mode === "code") || (label === "Build" && mode === "media") || (label === "Chat" && mode === "command")) ? styles.toolActive : ""} onClick={() => setMode(nextMode as WorkspaceMode)}>
                <Icon size={20} /><span>{label}</span>
              </button>
            ))}
          </div>
          <div className={styles.systemCard}><span><CircleDot size={12} />System status</span><b>All systems operational</b></div>
        </aside>

        <section className={styles.workspace}>
          <header className={styles.workspaceHeader}>
            <div className={styles.titleBlock}><span className={styles.titleIcon}><Hammer size={22} /></span><div><h1>Builder</h1><p>Your intelligent workspace. One command away.</p></div></div>
            <div className={styles.stackBadges}><span>Next.js</span><span>TypeScript</span><span>Tailwind</span><span>Supabase</span><span>Clerk</span></div>
            <div className={styles.workspaceActions}>
              <button><GitBranch size={14} />main</button><button><Files size={14} />3 files changed</button><button className={styles.synced}><ShieldCheck size={14} />Synced</button>
              <button className={styles.primaryAction} onClick={runBuild}>{runState === "running" ? <Activity size={15} className={styles.spin} /> : <Play size={15} />} {runState === "running" ? "Building" : runState === "done" ? "Built" : "Run build"}</button>
            </div>
          </header>

          <div className={styles.modeBar}>
            <button className={mode === "code" ? styles.modeActive : ""} onClick={() => setMode("code")}><Braces size={15} />Code workspace</button>
            <button className={mode === "media" ? styles.modeActive : ""} onClick={() => setMode("media")}><Video size={15} />Media pipeline</button>
            <button className={mode === "command" ? styles.modeActive : ""} onClick={() => setMode("command")}><Command size={15} />Command center</button>
            <button className={styles.rightToggle} onClick={() => setRightOpen((value) => !value)}>{rightOpen ? <X size={14} /> : <Sparkles size={14} />} AI panel</button>
          </div>

          {mode === "code" && (
            <div className={`${styles.ideGrid} ${!rightOpen ? styles.ideGridNoRight : ""}`}>
              <Explorer activePath={activePath} onSelect={setActivePath} />
              <section className={styles.centerStack}>
                <div className={styles.editorCard}>
                  <div className={styles.tabRow}>
                    {files.slice(0, 4).map((file) => <button key={file.path} className={file.path === activePath ? styles.tabActive : ""} onClick={() => setActivePath(file.path)}><FileCode2 size={14} /><span>{file.name}</span>{file.status === "modified" && <i>M</i>}</button>)}
                    <button className={styles.tabAdd}><Plus size={15} /></button>
                  </div>
                  <div className={styles.breadcrumbs}>app <ChevronRight size={12} /> studio <ChevronRight size={12} /> builder <ChevronRight size={12} /> {activeFile.name}</div>
                  <div className={styles.editorHost}>
                    <MonacoEditor
                      height="100%"
                      language={activeFile.language}
                      value={activeFile.content}
                      theme="vs-dark"
                      onChange={updateActiveFile}
                      options={{
                        automaticLayout: true,
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineHeight: 21,
                        fontFamily: "JetBrains Mono, ui-monospace, monospace",
                        padding: { top: 12 },
                        smoothScrolling: true,
                        scrollBeyondLastLine: false,
                        renderLineHighlight: "all",
                        cursorSmoothCaretAnimation: "on",
                      }}
                    />
                  </div>
                </div>
                <div className={styles.previewCard}>
                  <div className={styles.panelTitle}><span><Globe2 size={14} />Live preview <b className={styles.runningDot}>Running</b></span><span className={styles.previewActions}><button>Desktop</button><button><ExternalLink size={13} /></button></span></div>
                  <iframe title="LiTT live preview" sandbox="allow-scripts allow-forms" srcDoc={PREVIEW_HTML} />
                </div>
                <BottomPanel active={bottomTab} onChange={setBottomTab} />
              </section>
              {rightOpen && <AssistantPanel runBuild={runBuild} />}
            </div>
          )}

          {mode === "media" && <MediaWorkspace _prompt={prompt} _setPrompt={setPrompt} />}
          {mode === "command" && <CommandCenter />}

          <CommandDock prompt={prompt} setPrompt={setPrompt} mode={mode} />
        </section>
      </section>
    </main>
  );
}

function Explorer({ activePath, onSelect }: { activePath: string; onSelect: (path: string) => void }) {
  return (
    <aside className={styles.explorer}>
      <div className={styles.panelTitle}><span><Files size={14} />Explorer</span><MoreHorizontal size={16} /></div>
      <div className={styles.repoTitle}><ChevronDown size={13} />LITTREE-LABSTUDIOS</div>
      <div className={styles.tree}>
        <div><ChevronDown size={13} /><FolderOpen size={14} />app</div>
        <div className={styles.treeIndent1}><ChevronDown size={13} /><FolderOpen size={14} />(studio)</div>
        <div className={styles.treeIndent2}><ChevronDown size={13} /><FolderOpen size={14} />builder</div>
        {FILES.slice(0, 1).map((file) => <button key={file.path} className={`${styles.treeFile} ${activePath === file.path ? styles.treeFileActive : ""}`} onClick={() => onSelect(file.path)}><FileCode2 size={14} />{file.name}<i>M</i></button>)}
        <div><ChevronRight size={13} /><Folder size={14} />api</div>
        <div><ChevronDown size={13} /><FolderOpen size={14} />components</div>
        {FILES.slice(1, 3).map((file) => <button key={file.path} className={`${styles.treeFile} ${styles.treeIndent1} ${activePath === file.path ? styles.treeFileActive : ""}`} onClick={() => onSelect(file.path)}><FileCode2 size={14} />{file.name}{file.status === "modified" && <i>M</i>}</button>)}
        <div><ChevronRight size={13} /><Folder size={14} />lib</div>
        <div><ChevronRight size={13} /><Folder size={14} />hooks</div>
        <div><ChevronRight size={13} /><Folder size={14} />styles</div>
        <button className={styles.treeFile}><Package size={14} />package.json<i>M</i></button>
        <button className={styles.treeFile}><File size={14} />tsconfig.json<i>M</i></button>
      </div>
      <div className={styles.explorerFooter}><span>OUTLINE</span><span>TIMELINE</span></div>
    </aside>
  );
}

function BottomPanel({ active, onChange }: { active: BottomTab; onChange: (tab: BottomTab) => void }) {
  return (
    <section className={styles.bottomPanel}>
      <div className={styles.bottomTabs}>
        {(["terminal", "problems", "output"] as BottomTab[]).map((tab) => <button key={tab} className={active === tab ? styles.bottomTabActive : ""} onClick={() => onChange(tab)}>{tab === "terminal" && <SquareTerminal size={14} />}{tab === "problems" && <TestTube2 size={14} />}{tab === "output" && <Activity size={14} />}{tab}</button>)}
      </div>
      <div className={styles.bottomContent}>
        {active === "terminal" && <TerminalPane />}
        {active === "problems" && <div className={styles.emptyState}><Check size={26} /><b>No blocking problems</b><span>Type checking and linting are clean.</span></div>}
        {active === "output" && <pre className={styles.outputLog}>[LiTT] Workspace initialized\n[Preview] http://localhost:3000\n[Git] main · clean enough to build\n[Agents] 5 available</pre>}
      </div>
    </section>
  );
}

function AssistantPanel({ runBuild }: { runBuild: () => void }) {
  return (
    <aside className={styles.assistant}>
      <div className={styles.panelTitle}><span><Sparkles size={14} />AI Assistant</span><Zap size={14} /></div>
      <div className={styles.diffCard}>
        <div className={styles.diffHeader}><div><b>Diff review</b><span>3 files changed</span></div><strong><i>+142</i> <em>-28</em></strong></div>
        {["builder-shell.tsx", "TerminalPanel.tsx", "PreviewPane.tsx"].map((name, index) => <div className={styles.diffFile} key={name}><span><FileCode2 size={13} />{name}</span><b>+{[89, 34, 19][index]} <i>-{[12, 8, 8][index]}</i></b></div>)}
        <div className={styles.approvalRow}><button className={styles.approve}><Check size={15} />Approve</button><button><X size={15} />Reject</button></div>
        <button className={styles.fullButton}><Undo2 size={15} />Undo changes</button>
      </div>
      <button className={styles.assistantAction} onClick={runBuild}><Play size={15} />Run build</button>
      <button className={styles.assistantAction}><Rocket size={15} />Deploy</button>
      <div className={styles.activityCard}><b>Activity</b>{["Update builder shell layout", "Improve terminal performance", "Add preview panel", "Initial commit"].map((item, i) => <div key={item}><code>{["a1b2c3d", "f4e5d6c", "d7c8b9a", "b1a2e3f"][i]}</code><span>{item}</span><small>{["2m", "18m", "45m", "1h"][i]}</small></div>)}</div>
      <div className={styles.agentMiniList}><b>Active agents</b>{AGENTS.slice(0, 3).map((agent) => <div key={agent.id}><span style={{ background: agent.accent }}><Bot size={14} /></span><p><b>{agent.name}</b><small>{agent.role}</small></p><i>{agent.progress}%</i></div>)}</div>
    </aside>
  );
}

function MediaWorkspace({ _prompt, _setPrompt }: { _prompt: string; _setPrompt: (value: string) => void }) {
  return (
    <div className={styles.mediaLayout}>
      <section className={styles.mediaConversation}>
        <div className={styles.userBubble}><span>LB</span><div><b>You <small>4:15 PM</small></b><p>Turn my photo into a cinematic video.</p></div></div>
        <div className={styles.aiTaskCard}>
          <div className={styles.aiIdentity}><span><Sparkles size={17} /></span><b>LiTT AI <small>AI</small></b><MoreHorizontal size={16} /></div>
          <p>I’ll build a dynamic video with smooth motion, cinematic transitions and ambient effects.</p>
          {[
            ["Understanding your request", "Photo-to-video conversion with cinematic style", true],
            ["Loading generation models", "Motion + style transfer", true],
            ["Analyzing image and motion mapping", "Depth, scene flow and semantic regions", true],
            ["Generating video", "24fps · 5 seconds · 1080p", true],
            ["Finalizing and enhancing", "Color grade, stabilization and audio sync", false],
          ].map(([title, text, done]) => <div className={styles.taskStep} key={String(title)}><span className={done ? styles.stepDone : styles.stepRunning}>{done ? <Check size={13} /> : null}</span><div><b>{title}</b><small>{text}</small></div></div>)}
          <div className={styles.estimate}>Estimated completion: 12s <button><AppWindow size={14} />View live preview</button></div>
        </div>
      </section>
      <section className={styles.mediaDashboard}>
        <div className={styles.overviewCard}><div><b>Project overview</b><strong>78%</strong></div><svg viewBox="0 0 320 80" preserveAspectRatio="none"><polyline points="0,64 40,47 80,58 120,28 160,44 200,25 240,25 275,39 320,12" fill="none" stroke="url(#g)" strokeWidth="4"/><defs><linearGradient id="g"><stop stopColor="#2ce7ff"/><stop offset="1" stopColor="#9d47ff"/></linearGradient></defs></svg><footer><span>Tasks <b>12/16</b></span><span>Size <b>2.4 GB</b></span><span>Updated <b>2m ago</b></span></footer></div>
        <div className={styles.tasksCard}><b>Active tasks <small>4</small></b>{[["Video generation",78],["Style transfer",62],["Audio sync",34],["Render optimization",20]].map(([name, value]) => <div key={String(name)}><span>{name}<i>{value === 78 ? "In progress" : "Queued"}</i></span><em><i style={{ width: `${value}%` }} /></em></div>)}</div>
        <div className={styles.filesCard}><b>Files / artifacts <small>12</small></b>{[["output_video.mp4","2.4 GB"],["scene_depth.exr","128 MB"],["motion_map.json","45 KB"],["audio_track.wav","21 MB"]].map(([name,size]) => <div key={name}><span><FileCode2 size={15}/><p>{name}<small>{name.split(".").pop()?.toUpperCase()}</small></p></span><i>{size}</i></div>)}</div>
        <div className={styles.videoCard}><div className={styles.panelTitle}><span>Live preview</span><b>1080p</b></div><div className={styles.fakeVideo}><div className={styles.videoCity}><i/><i/><i/><i/><i/></div><button><Play size={24} fill="currentColor" /></button></div><footer><span>0:03 / 0:05</span><span>🔊　⌗</span></footer></div>
      </section>
      <aside className={styles.mediaSidebar}>
        <div className={styles.quickActions}><b><Sparkles size={14}/>Quick actions</b><div><button><Plus size={14}/>New project</button><button><Files size={14}/>Import assets</button><button><Workflow size={14}/>Run workflow</button><button><SquareTerminal size={14}/>Open terminal</button></div></div>
        <div className={styles.activeAgents}><b><Bot size={14}/>Active agents <small>3</small></b>{AGENTS.slice(0,3).map(agent => <div key={agent.id}><span style={{borderColor:agent.accent}}><Bot size={15}/></span><p><b>{agent.name}</b><small>{agent.status}</small></p><i style={{color:agent.accent}}>●</i></div>)}</div>
        <div className={styles.contextCard}><b>Project context</b>{[["Framework","Next.js"],["Language","TypeScript"],["Runtime","Node.js"],["Environment","Production"]].map(([a,b]) => <div key={a}><span>{a}</span><b>{b}</b></div>)}</div>
      </aside>
    </div>
  );
}

function CommandCenter() {
  return (
    <div className={styles.commandLayout}>
      <section className={styles.commandHero}>
        <div><small>ACTIVE PROJECT</small><h2>LiTT Command Center</h2><p>Everything you need. One workspace. Infinite possibilities.</p><div className={styles.projectStatus}><strong>littlabs-website</strong><span>Production</span></div><footer><span>Branch <b>main</b></span><span>Last deploy <b>2m ago</b></span><button>View deployment <ExternalLink size={13}/></button></footer></div>
        <div className={styles.mascot}><span className={styles.mascotEar}/><span className={styles.mascotEar2}/><div className={styles.mascotFace}><b>LiTT</b><i/><i/><em/></div><div className={styles.mascotBody}><Sparkles size={38}/></div></div>
        <div className={styles.systemOverview}><b>System overview</b>{[["Agents online","5/5"],["Tasks running","3"],["API calls","1,234/min"],["Storage","68%"]].map(([a,b],i)=><div key={a}><span><i className={styles.statDot} data-index={i}/>{a}</span><b>{b}</b></div>)}</div>
      </section>
      <section className={styles.commandMain}>
        <div className={styles.commandChat}><div className={styles.panelTitle}><span>AI command</span><span>Chat · Voice · Holo · Files · Tools</span></div><div className={styles.chatBody}><div className={styles.promptBubble}>Build a modern landing page with animations, pricing and a footer.</div><div className={styles.littReply}><span><Bot size={15}/></span><p><b>LiTT</b>I’ll build it with a stunning UI and production-ready structure.</p></div>{["Analyzing requirements","Creating components","Adding animations","Building responsive layout","Connecting sections"].map((item,i)=><div className={styles.chatCheck} key={item}><span className={i<3?styles.doneCheck:""}>{i<3?<Check size={11}/>:null}</span>{item}</div>)}</div></div>
        <div className={styles.agentBoard}><div className={styles.panelTitle}><span>Active agents</span><b>{AGENTS.length}</b></div>{AGENTS.map(agent => <div className={styles.agentRow} key={agent.id}><span style={{borderColor:agent.accent,color:agent.accent}}><Bot size={18}/></span><p><b>{agent.name}</b><small>{agent.role}</small><em><i style={{width:`${agent.progress}%`,background:agent.accent}}/></em></p><strong>{agent.progress}%</strong></div>)}</div>
        <div className={styles.monitor}><div className={styles.panelTitle}><span>System monitor</span><Activity size={14}/></div>{[["Performance",84],["API usage",54],["Storage",68],["Credits",91]].map(([name,value])=><div key={String(name)}><span>{name}<b>{value}%</b></span><em><i style={{width:`${value}%`}}/></em></div>)}</div>
      </section>
    </div>
  );
}

function CommandDock({ prompt, setPrompt, mode }: { prompt: string; setPrompt: (value: string) => void; mode: WorkspaceMode }) {
  return (
    <div className={styles.commandDock}>
      <div className={styles.voiceStates}><span><i/>Listening</span><span><i/>Thinking</span><span><i/>Speaking</span></div>
      <div className={styles.commandInput}><button><Plus size={19}/></button><textarea value={prompt} onChange={(event)=>setPrompt(event.target.value)} placeholder={`Ask LiTT to ${mode === "code" ? "edit, test or deploy code" : mode === "media" ? "create an image, video or audio workflow" : "plan and direct your agents"}…`} rows={1}/><div className={styles.commandTools}><button><Files size={14}/>Files</button><button><WandSparkles size={14}/>Tools</button><button><Network size={14}/>Agents</button></div><button className={styles.micButton}><Mic size={18}/></button><button className={styles.sendButton}><Send size={18}/></button></div>
    </div>
  );
}
