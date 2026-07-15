"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from "react";

export type StudioFile = {
  name: string;
  content: string;
  language: string;
};

export type StudioToolId =
  | "code"
  | "canvas"
  | "image"
  | "video"
  | "audio"
  | "flow"
  | "pipeline"
  | "gallery"
  | "cli"
  | "agents"
  | "agents-terminal"
  | "color"
  | "space";

type StudioState = {
  files: StudioFile[];
  activeFile: string;
  setActiveFile: (name: string) => void;
  setFiles: (files: StudioFile[]) => void;
  upsertFile: (file: StudioFile) => void;
  updateFileContent: (name: string, content: string) => void;
  removeFile: (name: string) => void;
  loadPresetFiles: (files: StudioFile[]) => void;
  activeTool: StudioToolId;
  setActiveTool: (id: StudioToolId) => void;
};

const StudioCtx = createContext<StudioState | undefined>(undefined);

const STARTER_FILES: StudioFile[] = [
  {
    name: "index.html",
    language: "html",
    content: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>LiTTree Code</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>Hello, LiTTree Code</h1>
      <p>Edit me on the left. Preview updates live.</p>
      <button id="btn">Click me</button>
    </main>
    <script src="script.js"></script>
  </body>
</html>
`,
  },
  {
    name: "styles.css",
    language: "css",
    content: `* { box-sizing: border-box }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #0c0c14;
  color: #e8e8f0;
}
main { text-align: center }
button {
  margin-top: 1rem;
  padding: 0.6rem 1.2rem;
  border: 0;
  border-radius: 10px;
  font-weight: 700;
  background: #38bdf8;
  color: #06223a;
  cursor: pointer;
}
`,
  },
  {
    name: "script.js",
    language: "javascript",
    content: `const btn = document.getElementById("btn");
let n = 0;
btn.addEventListener("click", () => {
  n += 1;
  btn.textContent = "Clicked " + n + " times";
});
`,
  },
];

export function StudioProvider({ children }: { children: ReactNode }) {
  const [files, setFilesState] = useState<StudioFile[]>(STARTER_FILES);
  const [activeFile, setActiveFileState] = useState<string>(STARTER_FILES[0].name);
  const [activeTool, setActiveToolState] = useState<StudioToolId>("code");

  const setActiveFile = useCallback((name: string) => {
    setActiveFileState(name);
  }, []);

  const setFiles = useCallback((next: StudioFile[]) => {
    setFilesState(next);
    if (next.length > 0 && !next.some((f) => f.name === activeFile)) {
      setActiveFileState(next[0].name);
    } else if (next.length === 0) {
      setActiveFileState("");
    }
  }, [activeFile]);

  const upsertFile = useCallback((file: StudioFile) => {
    setFilesState((prev) => {
      const idx = prev.findIndex((f) => f.name === file.name);
      if (idx === -1) {
        setActiveFileState(file.name);
        return [...prev, file];
      }
      const copy = prev.slice();
      copy[idx] = file;
      return copy;
    });
  }, []);

  const updateFileContent = useCallback((name: string, content: string) => {
    setFilesState((prev) =>
      prev.map((f) => (f.name === name ? { ...f, content } : f)),
    );
  }, []);

  const removeFile = useCallback((name: string) => {
    setFilesState((prev) => {
      const next = prev.filter((f) => f.name !== name);
      if (activeFile === name) {
        setActiveFileState(next[0]?.name ?? "");
      }
      return next;
    });
  }, [activeFile]);

  const loadPresetFiles = useCallback((next: StudioFile[]) => {
    setFilesState(next);
    setActiveFileState(next[0]?.name ?? "");
  }, []);

  const setActiveTool = useCallback((id: StudioToolId) => {
    setActiveToolState(id);
  }, []);

  const value = useMemo<StudioState>(
    () => ({
      files,
      activeFile,
      setActiveFile,
      setFiles,
      upsertFile,
      updateFileContent,
      removeFile,
      loadPresetFiles,
      activeTool,
      setActiveTool,
    }),
    [
      files,
      activeFile,
      setActiveFile,
      setFiles,
      upsertFile,
      updateFileContent,
      removeFile,
      loadPresetFiles,
      activeTool,
      setActiveTool,
    ],
  );

  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioCtx);
  if (!ctx) throw new Error("useStudio must be used within StudioProvider");
  return ctx;
}

export function buildPreviewDoc(files: StudioFile[]): string {
  const html =
    files.find((f) => f.name.endsWith(".html")) ??
    (files.some((f) => f.language === "html") ? files.find((f) => f.language === "html") : undefined);
  const css = files
    .filter((f) => f.name.endsWith(".css"))
    .map((f) => f.content)
    .join("\n\n");
  const js = files
    .filter((f) => f.name.endsWith(".js"))
    .map((f) => f.content)
    .join("\n\n");

  if (html) {
    let doc = html.content;
    if (css && !/<link[^>]+styles\.css/i.test(doc)) {
      doc = doc.replace("</head>", `<style>\n${css}\n</style>\n</head>`);
    } else if (css) {
      doc = doc.replace(
        /<link[^>]+href=["']styles\.css["'][^>]*>/i,
        `<style>\n${css}\n</style>`,
      );
    }
    if (js && !/<script[^>]+src=["']script\.js["']/i.test(doc)) {
      doc = doc.replace("</body>", `<script>\n${js}\n</script>\n</body>`);
    } else if (js) {
      doc = doc.replace(
        /<script[^>]+src=["']script\.js["'][^>]*><\/script>/i,
        `<script>\n${js}\n</script>`,
      );
    }
    return doc;
  }

  const allCode = files.map((f) => f.content).join("\n\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;padding:20px;background:#0a0a12;color:#e0e0e0;margin:0}
    *{box-sizing:border-box}
    pre{white-space:pre-wrap;font-size:13px;line-height:1.6}
  </style></head><body><pre>${allCode.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
}

export const PREVIEW_REPORTER_SCRIPT = `
<script>
(function(){
  function send(type, args){
    try {
      var payload = { __litPreview: true, type: type, args: args.map(function(a){
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(e){ return String(a); }
      }) };
      parent.postMessage(payload, '*');
    } catch(e){}
  }
  ['log','warn','error','info'].forEach(function(m){
    var orig = console[m];
    console[m] = function(){ send(m, Array.prototype.slice.call(arguments)); orig && orig.apply(console, arguments); };
  });
  window.addEventListener('error', function(e){ send('error', [e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')]); });
  window.addEventListener('unhandledrejection', function(e){ send('error', ['Unhandled promise rejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))]); });
})();
</script>`;

export function injectReporter(doc: string): string {
  if (doc.includes("__litPreview")) return doc;
  if (/<head>/i.test(doc)) return doc.replace(/<head>/i, "<head>" + PREVIEW_REPORTER_SCRIPT);
  if (/<body>/i.test(doc)) return doc.replace(/<body>/i, PREVIEW_REPORTER_SCRIPT + "<body>");
  return PREVIEW_REPORTER_SCRIPT + doc;
}

export function extractFencedFiles(text: string): {
  cleanText: string;
  files: StudioFile[];
} {
  const files: StudioFile[] = [];
  const re = /```(\w+)?\s*(?:\/\/\s*(.+?)\n|<!--\s*(.+?)\s*-->\n)?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let cleanText = text;
  while ((m = re.exec(text)) !== null) {
    const language = m[1] || "text";
    const filename = (m[2] || m[3] || defaultFileName(language)).trim();
    const content = m[4].trim();
    files.push({ name: filename, content, language });
    cleanText = cleanText.replace(m[0], `[${filename}]`);
  }
  return { cleanText, files };
}

function defaultFileName(language: string): string {
  switch (language) {
    case "html":
      return "index.html";
    case "css":
      return "styles.css";
    case "javascript":
    case "js":
      return "script.js";
    case "typescript":
    case "ts":
      return "script.ts";
    case "json":
      return "data.json";
    default:
      return `snippet.${language || "txt"}`;
  }
}