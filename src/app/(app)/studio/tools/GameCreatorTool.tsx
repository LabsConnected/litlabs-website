"use client";

import { useCallback, useState } from "react";
import { Check, Gamepad2, Loader2, Play, Rocket, Save, Sparkles, TestTube2 } from "lucide-react";

type Stage = "describe" | "project" | "files" | "preview" | "test" | "saved" | "published";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
const GAME_TEMPLATE = (title: string, description: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#fff;font:16px system-ui}main{text-align:center;max-width:620px;padding:32px}canvas{display:block;width:min(560px,90vw);height:320px;margin:24px auto;border:1px solid #334155;border-radius:16px;background:#111827}button{border:0;border-radius:10px;padding:12px 18px;background:#a8ff2f;color:#071008;font-weight:800;cursor:pointer}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><canvas id="game" width="560" height="320"></canvas><button id="start">Start game</button></main>
<script>const c=document.querySelector('#game'),x=c.getContext('2d');let running=false,score=0;function draw(){x.fillStyle='#111827';x.fillRect(0,0,c.width,c.height);x.fillStyle='#a8ff2f';x.beginPath();x.arc(280,160,24,0,Math.PI*2);x.fill();x.fillStyle='#fff';x.fillText('Score: '+score,16,24);if(running)requestAnimationFrame(draw)}document.querySelector('#start').onclick=()=>{running=true;score++;draw()};draw();</script></body></html>`;

export default function GameCreatorTool({ projectId: initialProjectId }: { projectId?: string | null }) {
  const [description, setDescription] = useState("A neon arcade game where the player collects glowing stars.");
  const [title, setTitle] = useState("Neon Star Collector");
  const [projectId, setProjectId] = useState(initialProjectId ?? null);
  const [stage, setStage] = useState<Stage>(initialProjectId ? "describe" : "describe");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }, []);

  const run = useCallback(async (next: Exclude<Stage, "describe">) => {
    setBusy(true); setError(null); setMessage(null);
    try {
      let activeId = projectId;
      if (!activeId) {
        const created = await request("/api/studio-projects", { method: "POST", body: JSON.stringify({ sourceType: "blank", name: title, templateId: "blank-static" }) });
        activeId = created.project?.id;
        if (!activeId) throw new Error("Project creation returned no project id.");
        setProjectId(activeId);
      }
      if (next === "project") { setStage("project"); setMessage(`Project ready: ${activeId}`); return; }
      await request(`/api/studio-projects/${activeId}/workspace/prepare`, { method: "POST" });
      if (next === "files" || next === "saved" || next === "preview" || next === "test" || next === "published") {
        await request(`/api/studio-projects/${activeId}/files`, { method: "POST", body: JSON.stringify({ action: "write", path: "index.html", content: GAME_TEMPLATE(title, description) }) });
      }
      if (next === "test") {
        const result = await request(`/api/studio-projects/${activeId}/checks/run-all`, { method: "POST" });
        const passed = (result.checks ?? []).filter((check: { status?: string }) => check.status === "passed").length;
        setMessage(`${passed} project checks passed.`);
      } else if (next === "published") {
        window.location.href = `/studio?project=${encodeURIComponent(activeId)}&tool=chat&prompt=${encodeURIComponent(`Review the ${title} game, run the checks, then deploy it after requesting the required approval.`)}`;
      } else {
        setMessage(next === "preview" ? "Preview is ready to open." : "Game files saved to the project workspace.");
      }
      setStage(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Game creator action failed."); }
    finally { setBusy(false); }
  }, [description, projectId, request, title]);

  const openPreview = () => projectId && (window.location.href = `/studio?project=${encodeURIComponent(projectId)}&tool=preview`);
  const steps: { id: Exclude<Stage, "describe">; label: string; icon: typeof Sparkles }[] = [
    { id: "project", label: "Create project", icon: Gamepad2 }, { id: "files", label: "Generate files", icon: Sparkles },
    { id: "preview", label: "Preview", icon: Play }, { id: "test", label: "Run tests", icon: TestTube2 }, { id: "saved", label: "Save", icon: Save }, { id: "published", label: "Publish", icon: Rocket },
  ];

  return <section className="mx-auto flex h-full max-w-3xl flex-col gap-5 overflow-y-auto p-5" data-testid="game-creator-tool">
    <header><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[.18em] text-violet-300"><Gamepad2 size={16} /> Create a game</div><h1 className="mt-2 text-2xl font-black text-white">Describe it. Build it. Play it.</h1><p className="mt-1 text-sm text-white/55">A real static game project is generated into your workspace so it can be previewed, tested, saved, and handed to LiTT for deployment approval.</p></header>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-white/65">Game title<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" /></label><label className="text-xs font-bold text-white/65 sm:col-span-2">Describe the game<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" /></label></div>
    <div className="grid gap-2 sm:grid-cols-3">{steps.map(({ id, label, icon: Icon }) => <button key={id} type="button" disabled={busy} onClick={() => void run(id)} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left text-xs font-bold transition hover:bg-white/10 disabled:opacity-50 ${stage === id ? "border-violet-400/60 bg-violet-400/15 text-violet-200" : "border-white/10 bg-white/[.03] text-white/70"}`}><Icon size={15} />{label}{stage === id && <Check size={14} className="ml-auto text-emerald-300" />}</button>)}</div>
    {busy && <div className="flex items-center gap-2 text-xs text-white/60"><Loader2 size={15} className="animate-spin" /> Working in the project workspace…</div>}
    {message && <p className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200">{message}</p>}
    {error && <p className="rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-xs text-red-200">{error}</p>}
    {projectId && <div className="flex flex-wrap gap-2"><button type="button" onClick={openPreview} className="rounded-xl bg-violet-400 px-4 py-2 text-xs font-black text-black"><Play size={13} className="mr-1 inline" />Open preview</button><span className="rounded-xl border border-white/10 px-3 py-2 text-[10px] text-white/45">Project {projectId.slice(0, 8)}</span></div>}
  </section>;
}
