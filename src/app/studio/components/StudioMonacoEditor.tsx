"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";

// ─── Worker configuration ───
// Monaco needs explicit worker URLs when bundled by Turbopack.
// We use new Worker(new URL(..., import.meta.url)) which is the
// standard web platform syntax that Turbopack supports natively.

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

// ─── Error Boundary ───

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
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onRetry();
            }}
            style={{
              border: "1px solid rgba(126,151,218,.2)",
              borderRadius: "8px",
              background: "rgba(255,255,255,.05)",
              color: "#f4f7ff",
              fontSize: "11px",
              fontWeight: 700,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            Retry editor
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Fallback textarea ───

function FallbackEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        background: "#030711",
        color: "#c8d3f0",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "13px",
        lineHeight: "1.6",
        padding: "12px",
        resize: "none",
        outline: "none",
        tabSize: 2,
      }}
    />
  );
}

// ─── Direct Monaco editor (no loader.config, no @monaco-editor/react) ───

function MonacoDirectEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const model = monaco.editor.createModel(value, "typescript");
    modelRef.current = model;

    const editor = monaco.editor.create(containerRef.current, {
      model,
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

    const sub = model.onDidChangeContent(() => {
      onChange(model.getValue());
    });

    return () => {
      sub.dispose();
      editor.dispose();
      model.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (modelRef.current && modelRef.current.getValue() !== value) {
      modelRef.current.setValue(value);
    }
  }, [value]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

// ─── Main component ───

export default function StudioMonacoEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [retryKey, setRetryKey] = useState(0);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    if (retryKey > 0) setUseFallback(false);
  }, [retryKey]);

  if (useFallback) {
    return <FallbackEditor value={value} onChange={onChange} />;
  }

  return (
    <EditorErrorBoundary onRetry={() => setRetryKey((k) => k + 1)}>
      <MonacoDirectEditor key={retryKey} value={value} onChange={onChange} />
    </EditorErrorBoundary>
  );
}
