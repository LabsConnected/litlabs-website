"use client";

import { startTransition, useState, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import { terminalAuthHeaders } from "@/lib/terminal-client";
import { Save, FileCode, X, Loader2 } from "lucide-react";

interface CodeEditorProps {
  filePath?: string;
  onClose?: () => void;
  onContentChange?: (content: string) => void;
}

export function CodeEditor({
  filePath,
  onClose,
  onContentChange,
}: CodeEditorProps) {
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsUrl =
    process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL ||
    process.env.NEXT_PUBLIC_TERMINAL_WS_URL ||
    "http://localhost:4001";

  const loadFile = useCallback(async () => {
    if (!filePath) return;
    startTransition(() => {
      setLoading(true);
      setError(null);
    });
    try {
      const res = await fetch(`${wsUrl}/files/read`, {
        method: "POST",
        headers: await terminalAuthHeaders(),
        body: JSON.stringify({ path: filePath }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setContent(data.content ?? "");
      setOriginal(data.content ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setLoading(false);
    }
  }, [filePath, wsUrl]);

  useEffect(() => {
    loadFile(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadFile]);

  const saveFile = async () => {
    if (!filePath) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${wsUrl}/files/write`, {
        method: "POST",
        headers: await terminalAuthHeaders(),
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOriginal(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const getLanguage = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return "typescript";
      case "js":
      case "jsx":
        return "javascript";
      case "json":
        return "json";
      case "css":
        return "css";
      case "html":
        return "html";
      case "md":
        return "markdown";
      case "py":
        return "python";
      default:
        return "plaintext";
    }
  };

  const dirty = content !== original;

  return (
    <div className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-semibold text-neutral-200">
            {filePath || "Untitled"}
          </span>
          {dirty && <span className="text-xs text-orange-400">● unsaved</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={saveFile}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 hover:bg-orange-500"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </button>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-900/50 bg-red-900/20 px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : (
          <Editor
            height="100%"
            language={filePath ? getLanguage(filePath) : "plaintext"}
            value={content}
            onChange={(value) => {
              const next = value ?? "";
              setContent(next);
              onContentChange?.(next);
            }}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "JetBrains Mono, Consolas, monospace",
              automaticLayout: true,
              padding: { top: 16 },
            }}
          />
        )}
      </div>
    </div>
  );
}
