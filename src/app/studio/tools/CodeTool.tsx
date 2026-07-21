"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-json";
import {
  Code,
  Copy,
  Check,
  Download,
  Eye,
  Plus,
  RefreshCw,
  FileCode,
  Save,
  FolderOpen,
  Trash2,
  ChevronDown,
  Terminal,
  X,
  AlertTriangle,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { buildPreviewDoc, injectReporter, useStudio } from "../studio-context";
import {
  deleteProjectLocal,
  getActiveProjectIdLocal,
  listProjectsLocal,
  loadProjectLocal,
  newProject,
  saveProjectLocal,
  setActiveProjectIdLocal,
  type StudioProject,
} from "@/lib/studio-projects";

const NEW_FILE_TEMPLATES: Record<string, { name: string; content: string; language: string }> = {
  html: {
    name: "index.html",
    language: "html",
    content: `<!DOCTYPE html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n    <title>Untitled</title>\n  </head>\n  <body>\n    <h1>New page</h1>\n  </body>\n</html>\n`,
  },
  css: { name: "styles.css", language: "css", content: `/* styles */\nbody { margin: 0 }\n` },
  js: { name: "script.js", language: "javascript", content: `// script\nconsole.log("hello");\n` },
};

const PRISM_LANG: Record<string, string> = {
  html: "markup",
  markup: "markup",
  css: "css",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  json: "json",
};

type ConsoleEntry = { id: number; level: "log" | "warn" | "error" | "info"; text: string };

export default function CodeTool() {
  const T = useTheme().resolvedColors;
  const { files, activeFile, setActiveFile, updateFileContent, loadPresetFiles } = useStudio();
  const { userId } = useClerkAuth();
  const [view, setView] = useState<"split" | "code" | "preview">("split");
  const [copied, setCopied] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  // --- Projects ---
  const [activeProject, setActiveProject] = useState<StudioProject | null>(() => {
    const id = getActiveProjectIdLocal();
    return id ? loadProjectLocal(id) : null;
  });
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projects, setProjects] = useState<StudioProject[]>(() => listProjectsLocal());
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // Dirty is derived: compare current content signature to the last-saved snapshot.
  const signature = useMemo(
    () => (activeProject ? JSON.stringify({ files, activeFile }) : ""),
    [activeProject, files, activeFile],
  );
  const [savedSignature, setSavedSignature] = useState<string>(() => {
    const id = getActiveProjectIdLocal();
    const p = id ? loadProjectLocal(id) : null;
    return p ? JSON.stringify({ files: p.files, activeFile: p.activeFile }) : "";
  });
  const dirty = activeProject ? signature !== savedSignature : false;

  // --- Console overlay ---
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const entryId = useRef(0);

  // Restore active project files into the editor once on mount.
  // Uses context setters (not local setState), runs once.
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    const id = getActiveProjectIdLocal();
    const p = id ? loadProjectLocal(id) : null;
    if (p && p.files.length > 0) {
      loadPresetFiles(p.files);
      setActiveFile(p.activeFile || p.files[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave to active project (debounced). State updates happen inside the
  // timeout callback (not synchronously in the effect body).
  useEffect(() => {
    if (!activeProject || !dirty) return;
    const t = setTimeout(() => {
      const updated: StudioProject = {
        ...activeProject,
        files,
        activeFile,
        updatedAt: Date.now(),
      };
      const saved = saveProjectLocal(updated);
      setActiveProject(saved);
      setSavedSignature(JSON.stringify({ files, activeFile }));
      setProjects(listProjectsLocal());
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, dirty]);

  // Listen to preview console messages
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object" || !d.__litPreview) return;
      const level = (d.type as ConsoleEntry["level"]) || "log";
      const text = Array.isArray(d.args) ? d.args.join(" ") : String(d.args);
      setConsoleEntries((prev) => [...prev.slice(-200), { id: entryId.current++, level, text }]);
      if (level === "error") setConsoleOpen(true);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const doc = useMemo(() => injectReporter(buildPreviewDoc(files)), [files]);
  const current = files.find((f) => f.name === activeFile);
  const errorCount = consoleEntries.filter((e) => e.level === "error").length;

  const copyCurrent = () => {
    if (!current) return;
    navigator.clipboard.writeText(current.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadCurrent = () => {
    if (!current) return;
    const blob = new Blob([current.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = current.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addFile = (kind: "html" | "css" | "js") => {
    const base = NEW_FILE_TEMPLATES[kind];
    let name = base.name;
    let i = 2;
    while (files.some((f) => f.name === name)) {
      name = base.name.replace(/(\.\w+)$/, `${i}$1`);
      i += 1;
    }
    loadPresetFiles([...files, { ...base, name }]);
    setActiveFile(name);
    setShowAdd(false);
  };

  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && current) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = current.content.slice(0, start) + "  " + current.content.slice(end);
      updateFileContent(current.name, next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  };

  // --- Project actions ---
  const syncSavedSignature = (p: StudioProject) => setSavedSignature(JSON.stringify({ files: p.files, activeFile: p.activeFile }));

  const createProject = () => {
    const p = newProject("Untitled Project", files);
    const saved = saveProjectLocal(p);
    setActiveProjectIdLocal(p.id);
    setActiveProject(saved);
    syncSavedSignature(saved);
    setProjects(listProjectsLocal());
    setProjectMenuOpen(false);
    setRenaming(true);
    setRenameValue(saved.name);
  };

  const openProject = (id: string) => {
    const p = loadProjectLocal(id);
    if (!p) return;
    setActiveProjectIdLocal(p.id);
    setActiveProject(p);
    syncSavedSignature(p);
    if (p.files.length > 0) {
      loadPresetFiles(p.files);
      setActiveFile(p.activeFile || p.files[0].name);
    }
    setProjectMenuOpen(false);
  };

  const removeProject = (id: string) => {
    deleteProjectLocal(id);
    setProjects(listProjectsLocal());
    if (activeProject?.id === id) {
      setActiveProject(null);
      setActiveProjectIdLocal(null);
      setSavedSignature("");
    }
  };

  const commitRename = () => {
    if (!activeProject) return;
    const name = renameValue.trim() || "Untitled Project";
    const saved = saveProjectLocal({ ...activeProject, name });
    setActiveProject(saved);
    syncSavedSignature(saved);
    setProjects(listProjectsLocal());
    setRenaming(false);
  };

  const showCode = view !== "preview";
  const showPreview = view !== "code";

  return (
    <div className="flex h-full overflow-hidden" style={{ backgroundColor: T.bgColor }}>
      {/* Editor side */}
      {showCode && (
        <div className="flex flex-col min-w-0 flex-1 border-r" style={{ borderColor: T.borderColor + "20" }}>
          {/* Top row: project menu */}
          <div className="flex items-center gap-1 px-2 h-10 border-b shrink-0" style={{ borderColor: T.borderColor + "18", backgroundColor: T.boxBg }}>
            <div className="relative">
              <button
                onClick={() => setProjectMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11px] font-bold shrink-0"
                style={{ backgroundColor: T.bgColor + "70", border: `1px solid ${T.borderColor}30`, color: T.textColor }}
              >
                <FolderOpen size={12} style={{ color: T.accentColor }} />
                {activeProject ? (
                  <span className="max-w-[140px] truncate">{activeProject.name}</span>
                ) : (
                  <span style={{ color: T.textMuted }}>No project</span>
                )}
                {dirty && activeProject && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: T.warning }} title="unsaved" />}
                <ChevronDown size={12} style={{ color: T.textMuted }} />
              </button>
              {projectMenuOpen && (
                <div
                  className="absolute top-9 left-0 z-20 w-64 rounded-xl border overflow-hidden shadow-2xl"
                  style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40" }}
                >
                  <div className="flex items-center justify-between px-3 h-9 border-b" style={{ borderColor: T.borderColor + "20" }}>
                    <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: T.textMuted }}>Projects</span>
                    <button onClick={createProject} className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: T.accentColor + "15", color: T.accentColor }}>
                      <Plus size={11} /> New
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {projects.length === 0 && (
                      <div className="px-3 py-4 text-center text-[11px]" style={{ color: T.textMuted }}>
                        No projects yet. Click <span style={{ color: T.accentColor }}>New</span> to save the current editor.
                      </div>
                    )}
                    {projects.map((p) => (
                      <div
                        key={p.id}
                        className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5"
                        onClick={() => openProject(p.id)}
                        style={{ backgroundColor: activeProject?.id === p.id ? T.accentColor + "10" : "transparent" }}
                      >
                        <FileCode size={12} style={{ color: activeProject?.id === p.id ? T.accentColor : T.textMuted }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold truncate" style={{ color: T.textColor }}>{p.name}</div>
                          <div className="text-[9px]" style={{ color: T.textMuted }}>{p.files.length} files · {new Date(p.updatedAt).toLocaleDateString()}</div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeProject(p.id); }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-md"
                          style={{ color: "#ff6b6b" }}
                          title="Delete"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {userId && (
                    <div className="px-3 h-8 border-t flex items-center text-[9px]" style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
                      Local storage · cloud sync when Supabase configured
                    </div>
                  )}
                </div>
              )}
            </div>

            {renaming && activeProject && (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }}
                  onBlur={commitRename}
                  className="px-2 h-7 rounded-md text-[11px] font-bold bg-transparent outline-none"
                  style={{ border: `1px solid ${T.accentColor}40`, color: T.textColor, width: 140 }}
                />
              </div>
            )}

            {/* File tabs */}
            <div className="flex items-center gap-1 ml-1 overflow-x-auto min-w-0">
              {files.map((f) => {
                const active = f.name === activeFile;
                return (
                  <button
                    key={f.name}
                    onClick={() => setActiveFile(f.name)}
                    className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 transition-all"
                    style={{
                      backgroundColor: active ? T.accentColor + "15" : "transparent",
                      color: active ? T.accentColor : T.textMuted,
                      border: `1px solid ${active ? T.accentColor + "30" : "transparent"}`,
                    }}
                  >
                    <FileCode size={11} />
                    {f.name}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="ml-auto p-1.5 rounded-lg shrink-0"
              style={{ color: showAdd ? T.accentColor : T.textMuted, backgroundColor: showAdd ? T.accentColor + "15" : "transparent" }}
              title="New file"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={() => { if (activeProject) { const saved = saveProjectLocal({ ...activeProject, files, activeFile, updatedAt: Date.now() }); setActiveProject(saved); syncSavedSignature(saved); setProjects(listProjectsLocal()); } }}
              className="p-1.5 rounded-lg shrink-0"
              style={{ color: T.textMuted }}
              title="Save now"
            >
              <Save size={13} />
            </button>
          </div>

          {/* Add file row */}
          {showAdd && (
            <div className="flex items-center gap-2 px-3 h-10 border-b" style={{ borderColor: T.borderColor + "18", backgroundColor: T.boxBg + "70" }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>New</span>
              {(["html", "css", "js"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => addFile(k)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all hover:scale-105"
                  style={{ backgroundColor: T.accentColor + "12", color: T.accentColor, border: `1px solid ${T.accentColor}25` }}
                >
                  .{k}
                </button>
              ))}
              <button onClick={() => setShowAdd(false)} className="ml-auto text-[10px] px-2" style={{ color: T.textMuted }}>[esc]</button>
            </div>
          )}

          {/* Editor toolbar */}
          <div className="flex items-center justify-between px-3 h-9 border-b shrink-0" style={{ borderColor: T.borderColor + "12", backgroundColor: T.boxBg + "40" }}>
            <span className="text-[10px] font-mono opacity-60" style={{ color: T.textMuted }}>
              {current ? `${current.name} · ${current.language}` : "no file"}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={copyCurrent} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: T.textMuted }} title="Copy">
                {copied ? <Check className="pointer-events-none" size={12} style={{ color: T.success }} aria-hidden="true" /> : <Copy className="pointer-events-none" size={12} aria-hidden="true" />}
              </button>
              <button onClick={downloadCurrent} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: T.textMuted }} title="Download">
                <Download className="pointer-events-none" size={12} aria-hidden="true" />
              </button>
              <ViewToggle view={view} setView={setView} mode="code" icon={<Code className="pointer-events-none" size={12} />} title="Code only" T={T} />
              <ViewToggle view={view} setView={setView} mode="split" icon={<SplitIcon className="pointer-events-none" aria-hidden="true" />} title="Split" T={T} className="hidden md:flex" />
              <ViewToggle view={view} setView={setView} mode="preview" icon={<Eye className="pointer-events-none" size={12} />} title="Preview only" T={T} />
            </div>
          </div>

          {/* Code area */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {current ? (
              <CodeEditor
                key={current.name}
                value={current.content}
                language={current.language}
                onChange={(v) => updateFileContent(current.name, v)}
                onKeyDown={handleTab}
                textareaRef={textareaRef}
                highlightRef={highlightRef}
              />
            ) : (
              <div className="flex-1 grid place-items-center text-xs" style={{ color: T.textMuted }}>
                No file. Create one with <Plus size={12} className="inline mx-1" /> above.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview side */}
      {showPreview && (
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center justify-between px-3 h-9 border-b shrink-0" style={{ borderColor: T.borderColor + "18", backgroundColor: T.boxBg + "40" }}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: T.success }} />
              <span className="text-[10px] font-mono" style={{ color: T.textMuted }}>preview · render-only</span>
            </div>
            <div className="flex items-center gap-1">
              <ViewToggle view={view} setView={setView} mode="code" icon={<Code className="pointer-events-none" size={12} />} title="Code only" T={T} />
              <ViewToggle view={view} setView={setView} mode="split" icon={<SplitIcon className="pointer-events-none" aria-hidden="true" />} title="Split" T={T} />
              <ViewToggle view={view} setView={setView} mode="preview" icon={<Eye className="pointer-events-none" size={12} />} title="Preview only" T={T} />
              <button
                onClick={() => setConsoleOpen((v) => !v)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold"
                style={{
                  color: errorCount > 0 ? "#ff6b6b" : T.textMuted,
                  border: `1px solid ${errorCount > 0 ? "#ff6b6b55" : T.borderColor + "30"}`,
                  backgroundColor: errorCount > 0 ? "#ff6b6b12" : "transparent",
                }}
                title="Console"
              >
                <Terminal className="pointer-events-none" size={11} aria-hidden="true" />
                {errorCount > 0 && <span>{errorCount}</span>}
              </button>
              <button
                onClick={() => { setConsoleEntries([]); setPreviewKey((k) => k + 1); }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold ml-1"
                style={{ color: T.textMuted, border: `1px solid ${T.borderColor}30` }}
              >
                <RefreshCw className="pointer-events-none" size={11} aria-hidden="true" /> Reload
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 relative">
            <iframe
              key={previewKey}
              srcDoc={doc}
              className="w-full h-full border-0 bg-white"
              title="preview"
              sandbox="allow-scripts"
            />
            {consoleOpen && (
              <ConsolePanel entries={consoleEntries} onClose={() => setConsoleOpen(false)} onClear={() => setConsoleEntries([])} T={T} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ViewToggle({
  view,
  setView,
  mode,
  icon,
  title,
  T,
  className = "",
}: {
  view: "split" | "code" | "preview";
  setView: (v: "split" | "code" | "preview") => void;
  mode: "split" | "code" | "preview";
  icon: React.ReactNode;
  title: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => setView(mode)}
      className={`p-1.5 rounded-lg ${className}`}
      style={{
        color: view === mode ? T.accentColor : T.textMuted,
        backgroundColor: view === mode ? T.accentColor + "15" : "transparent",
      }}
      title={title}
    >
      {icon}
    </button>
  );
}

function CodeEditor({
  value,
  language,
  onChange,
  onKeyDown,
  textareaRef,
  highlightRef,
}: {
  value: string;
  language: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  highlightRef: React.RefObject<HTMLPreElement | null>;
}) {
  const T = useTheme().resolvedColors;
  const lineCount = value.split("\n").length;
  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount],
  );

  const prismLang = PRISM_LANG[language] || "markup";
  const highlighted = useMemo(() => {
    try {
      const grammar = Prism.languages[prismLang] ?? Prism.languages.markup;
      return Prism.highlight(value, grammar, prismLang);
    } catch {
      return escapeHtml(value);
    }
  }, [value, prismLang]);

  // Sync scroll between textarea and highlight layer
  const onScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden font-mono text-[12.5px] leading-[1.6]">
      <pre
        aria-hidden
        className="select-none text-right px-2 py-3 overflow-hidden shrink-0"
        style={{ color: T.textMuted + "80", backgroundColor: T.boxBg + "30", width: 48, minWidth: 48 }}
      >
        {gutter}
      </pre>
      <div className="relative flex-1 min-w-0 overflow-hidden">
        <pre
          ref={highlightRef}
          aria-hidden
          className="absolute inset-0 m-0 px-3 py-3 overflow-auto pointer-events-none whitespace-pre"
          style={{ color: T.textColor, backgroundColor: "transparent" }}
          dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          spellCheck={false}
          wrap="off"
          className="absolute inset-0 w-full h-full resize-none bg-transparent outline-none px-3 py-3 overflow-auto whitespace-pre"
          style={{ color: "transparent", caretColor: T.accentColor, tabSize: 2, WebkitTextFillColor: "transparent" }}
        />
      </div>
    </div>
  );
}

function ConsolePanel({
  entries,
  onClose,
  onClear,
  T,
}: {
  entries: ConsoleEntry[];
  onClose: () => void;
  onClear: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="absolute left-0 right-0 bottom-0 max-h-[45%] flex flex-col border-t" style={{ backgroundColor: T.boxBg + "f5", borderColor: T.borderColor + "30", backdropFilter: "blur(6px)" }}>
      <div className="flex items-center justify-between px-3 h-8 border-b shrink-0" style={{ borderColor: T.borderColor + "20" }}>
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>
          <Terminal size={12} style={{ color: T.accentColor }} /> Console
        </span>
        <div className="flex items-center gap-1">
          <button onClick={onClear} className="text-[10px] px-2 py-0.5 rounded-md" style={{ color: T.textMuted, border: `1px solid ${T.borderColor}30` }}>Clear</button>
          <button onClick={onClose} className="p-1 rounded-md" style={{ color: T.textMuted }}><X size={12} /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed space-y-0.5">
        {entries.length === 0 && <div className="text-center py-4 opacity-60" style={{ color: T.textMuted }}>No output yet.</div>}
        {entries.map((e) => (
          <div key={e.id} className="flex gap-2 px-1">
            <span style={{ color: e.level === "error" ? "#ff6b6b" : e.level === "warn" ? T.warning : T.textMuted + "90" }}>
              {e.level === "error" ? <AlertTriangle size={10} className="inline mr-1" /> : null}
            </span>
            <span className="whitespace-pre-wrap break-words" style={{ color: e.level === "error" ? "#ff9999" : e.level === "warn" ? "#ffd699" : T.textColor + "cc" }}>
              {e.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitIcon({
  className,
  "aria-hidden": ariaHidden,
}: {
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={ariaHidden}
      style={{ pointerEvents: "none" }}
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
