"use client";

import { Component, lazy, Suspense, useState, useEffect, type ReactNode } from "react";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// editor.all registers all Monaco services (undoRedoService, modelService, etc.)
// that editor.main (the default entry) may not include when tree-shaken by Turbopack
import "monaco-editor/esm/vs/editor/editor.all";

// Configure Monaco to use the locally bundled monaco-editor (not jsDelivr CDN)
loader.config({ monaco });

// Lazy-load @monaco-editor/react so the editor component itself is code-split
const MonacoEditor = lazy(() => import("@monaco-editor/react"));

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

  // Detect loader init failure
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      loader.init().catch(() => {
        if (!cancelled) setUseFallback(true);
      });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [retryKey]);

  if (useFallback) {
    return <FallbackEditor value={value} onChange={onChange} />;
  }

  return (
    <EditorErrorBoundary onRetry={() => setRetryKey((k) => k + 1)}>
      <Suspense
        fallback={
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#5a6480", fontSize: "11px" }}>
            Loading editor…
          </div>
        }
      >
        <MonacoEditor
          key={retryKey}
          height="100%"
          language="typescript"
          value={value}
          theme="vs-dark"
          onChange={(v) => onChange(v ?? "")}
          loading={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#5a6480", fontSize: "11px" }}>
              Loading editor…
            </div>
          }
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
          }}
        />
      </Suspense>
    </EditorErrorBoundary>
  );
}
