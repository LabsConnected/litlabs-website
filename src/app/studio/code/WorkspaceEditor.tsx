"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import type { OpenEditorFile } from "./code-types";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    let url: URL;
    switch (label) {
      case "typescript":
      case "javascript":
        url = new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url);
        break;
      case "css":
        url = new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url);
        break;
      case "html":
        url = new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url);
        break;
      case "json":
        url = new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url);
        break;
      default:
        url = new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url);
        break;
    }
    return new Worker(url);
  },
};

type ErrorBoundaryState = { hasError: boolean; error: Error | null };

class EditorErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode; onRetry: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error("Monaco editor failed:", error.message);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "8px", padding: "16px", textAlign: "center" }}>
          <p style={{ fontSize: "12px", color: "#8995b2", fontWeight: 600 }}>Editor unavailable</p>
          <p style={{ fontSize: "10px", color: "#5a6480", maxWidth: "280px" }}>
            {this.state.error?.message ?? "The code editor could not be initialized."}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); this.props.onRetry(); }}
            style={{ border: "1px solid rgba(126,151,218,.2)", borderRadius: "8px", background: "rgba(255,255,255,.05)", color: "#f4f7ff", fontSize: "11px", fontWeight: 700, padding: "6px 14px", cursor: "pointer" }}
          >
            Retry editor
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function getFileModel(path: string, content: string, language: string): monaco.editor.ITextModel {
  const uri = monaco.Uri.parse(`file:///workspace/${path}`);
  const existing = monaco.editor.getModel(uri);
  if (existing) return existing;
  return monaco.editor.createModel(content, language, uri);
}

interface WorkspaceEditorProps {
  path: string | null;
  file: OpenEditorFile | null;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onFocusTerminal?: () => void;
}

function MonacoWorkspaceEditor({ path, file, onChange, onSave, onFocusTerminal }: WorkspaceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const currentPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      model: null,
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      tabSize: 2,
      lineNumbers: "on",
      roundedSelection: true,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    });
    editorRef.current = editor;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (currentPathRef.current) onSave(currentPathRef.current);
    });

    if (onFocusTerminal) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ, () => {
        onFocusTerminal();
      });
    }

    return () => {
      editor.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !path || !file) {
      if (editor) editor.setModel(null);
      currentPathRef.current = null;
      return;
    }

    const model = getFileModel(path, file.content, file.language);
    if (model.getValue() !== file.content) {
      model.setValue(file.content);
    }
    editor.setModel(model);
    currentPathRef.current = path;

    const sub = model.onDidChangeContent(() => {
      onChange(path, model.getValue());
    });

    return () => {
      sub.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, file?.version]);

  if (!path || !file) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-white/40">
        <p>Select a file from the explorer to start editing</p>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

export default function WorkspaceEditor(props: WorkspaceEditorProps) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <EditorErrorBoundary onRetry={() => setRetryKey((k) => k + 1)}>
      <MonacoWorkspaceEditor key={retryKey} {...props} />
    </EditorErrorBoundary>
  );
}
