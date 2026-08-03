"use client";

import { useState, useCallback, useMemo } from "react";
import type { CanvasBlock } from "@/lib/canvas/types";
import { cn } from "@/lib/utils";

// ─── Block renderer ──────────────────────────────────────────────

interface BlockRendererProps {
  block: CanvasBlock;
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  readOnly?: boolean;
}

export function BlockRenderer({ block, onUpdate, onDelete, readOnly }: BlockRendererProps) {
  switch (block.type) {
    case "heading":
      return <HeadingBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    case "paragraph":
      return <ParagraphBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    case "checklist":
      return <ChecklistBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    case "task":
      return <TaskBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    case "code":
      return <CodeBlockView block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    case "note":
      return <NoteBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    case "decision":
      return <DecisionBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    case "image":
      return <ImageBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    case "file":
      return <FileBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    case "preview":
      return <PreviewBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
    default:
      return <UnknownBlock block={block} onUpdate={onUpdate} onDelete={onDelete} readOnly={readOnly} />;
  }
}

// ─── Block wrapper ───────────────────────────────────────────────

function BlockWrapper({
  block,
  onDelete,
  readOnly,
  children,
  className,
}: {
  block: CanvasBlock;
  onDelete: () => void;
  readOnly?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative rounded-lg border border-white/5 bg-white/[0.02] p-3 transition-colors hover:border-white/10",
        className,
      )}
    >
      {!readOnly && (
        <button
          onClick={onDelete}
          className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 text-white/30 hover:text-red-400 text-xs"
          aria-label="Delete block"
        >
          ✕
        </button>
      )}
      {children}
    </div>
  );
}

// ─── Heading ─────────────────────────────────────────────────────

function HeadingBlock({ block, onUpdate, readOnly }: BlockRendererProps) {
  const content = block.content as { text: string; level?: number };
  const level = content.level ?? 2;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(content.text);

  const handleSave = useCallback(() => {
    setEditing(false);
    if (text !== content.text) onUpdate({ text });
  }, [text, content.text, onUpdate]);

  const headingClass = cn(
    "font-semibold text-white cursor-text",
    level === 1 && "text-2xl",
    level === 2 && "text-xl",
    level === 3 && "text-lg",
    level >= 4 && "text-base",
  );

  if (editing && !readOnly) {
    return (
      <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly}>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          className="w-full bg-transparent text-lg font-semibold text-white outline-none"
        />
      </BlockWrapper>
    );
  }

  const renderHeading = () => {
    const props = {
      className: headingClass,
      onClick: () => !readOnly && setEditing(true),
      children: content.text,
    };
    switch (level) {
      case 1: return <h1 {...props} />;
      case 2: return <h2 {...props} />;
      case 3: return <h3 {...props} />;
      case 4: return <h4 {...props} />;
      case 5: return <h5 {...props} />;
      default: return <h6 {...props} />;
    }
  };

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly} className="bg-transparent border-0 p-0 hover:bg-white/[0.02]">
      {renderHeading()}
    </BlockWrapper>
  );
}

// ─── Paragraph ───────────────────────────────────────────────────

function ParagraphBlock({ block, onUpdate, readOnly }: BlockRendererProps) {
  const content = block.content as { text: string };
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(content.text);

  const handleSave = useCallback(() => {
    setEditing(false);
    if (text !== content.text) onUpdate({ text });
  }, [text, content.text, onUpdate]);

  if (editing && !readOnly) {
    return (
      <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly}>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleSave}
          rows={3}
          className="w-full bg-transparent text-sm text-white/90 outline-none resize-y"
        />
      </BlockWrapper>
    );
  }

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly} className="bg-transparent border-0 p-0 hover:bg-white/[0.02]">
      <p
        className="text-sm text-white/80 whitespace-pre-wrap cursor-text leading-relaxed"
        onClick={() => !readOnly && setEditing(true)}
      >
        {content.text}
      </p>
    </BlockWrapper>
  );
}

// ─── Checklist ───────────────────────────────────────────────────

function ChecklistBlock({ block, onUpdate, readOnly }: BlockRendererProps) {
  const content = block.content as { items: Array<{ id: string; text: string; checked: boolean }> };
  const items = useMemo(() => content.items ?? [], [content.items]);

  const toggleItem = useCallback((id: string) => {
    if (readOnly) return;
    onUpdate({
      items: items.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item,
      ),
    });
  }, [items, onUpdate, readOnly]);

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly}>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <button
              onClick={() => toggleItem(item.id)}
              disabled={readOnly}
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0 rounded border transition-colors",
                item.checked
                  ? "border-cyan-400 bg-cyan-400/20"
                  : "border-white/20 hover:border-white/40",
              )}
            >
              {item.checked && <span className="text-cyan-400 text-xs">✓</span>}
            </button>
            <span
              className={cn(
                "text-sm",
                item.checked ? "text-white/40 line-through" : "text-white/80",
              )}
            >
              {item.text}
            </span>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-sm text-white/30 italic">No items yet</li>
        )}
      </ul>
    </BlockWrapper>
  );
}

// ─── Task ────────────────────────────────────────────────────────

function TaskBlock({ block, onUpdate, readOnly }: BlockRendererProps) {
  const content = block.content as {
    title: string;
    description: string;
    status: "todo" | "in_progress" | "done" | "blocked";
    assignee?: string;
  };

  const statusColors: Record<string, string> = {
    todo: "bg-white/10 text-white/60",
    in_progress: "bg-blue-500/20 text-blue-300",
    done: "bg-green-500/20 text-green-300",
    blocked: "bg-red-500/20 text-red-300",
  };

  const cycleStatus = useCallback(() => {
    if (readOnly) return;
    const order: Array<typeof content.status> = ["todo", "in_progress", "done", "blocked"];
    const currentIdx = order.indexOf(content.status);
    const next = order[(currentIdx + 1) % order.length];
    onUpdate({ status: next });
  }, [content, onUpdate, readOnly]);

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly}>
      <div className="flex items-start gap-3">
        <button
          onClick={cycleStatus}
          disabled={readOnly}
          className={cn(
            "mt-0.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase transition-colors",
            statusColors[content.status],
          )}
        >
          {content.status.replace("_", " ")}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white">{content.title}</div>
          {content.description && (
            <div className="text-xs text-white/50 mt-0.5">{content.description}</div>
          )}
          {content.assignee && (
            <div className="text-[10px] text-white/30 mt-1">@{content.assignee}</div>
          )}
        </div>
      </div>
    </BlockWrapper>
  );
}

// ─── Code ────────────────────────────────────────────────────────

function CodeBlockView({ block, readOnly }: BlockRendererProps) {
  const content = block.content as { language: string; code: string; filename?: string };

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly} className="p-0 overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <span className="text-[10px] font-mono text-white/40">
          {content.filename ?? content.language ?? "code"}
        </span>
        <span className="text-[10px] font-mono text-white/20">{content.language}</span>
      </div>
      <pre className="overflow-x-auto p-3 text-xs font-mono text-white/80 leading-relaxed">
        <code>{content.code}</code>
      </pre>
    </BlockWrapper>
  );
}

// ─── Note ────────────────────────────────────────────────────────

function NoteBlock({ block, onUpdate, readOnly }: BlockRendererProps) {
  const content = block.content as { text: string; pinned?: boolean };

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly} className="border-yellow-500/20 bg-yellow-500/[0.03]">
      <div className="flex items-start gap-2">
        {content.pinned && <span className="text-yellow-400 text-xs">📌</span>}
        <p className="text-sm text-white/80 whitespace-pre-wrap flex-1">{content.text}</p>
      </div>
    </BlockWrapper>
  );
}

// ─── Decision ────────────────────────────────────────────────────

function DecisionBlock({ block, readOnly }: BlockRendererProps) {
  const content = block.content as { title: string; rationale: string; decidedAt?: string };

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly} className="border-purple-500/20 bg-purple-500/[0.03]">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-purple-400 text-xs">DECISION</span>
      </div>
      <div className="text-sm font-medium text-white">{content.title}</div>
      {content.rationale && (
        <div className="text-xs text-white/50 mt-1">{content.rationale}</div>
      )}
      {content.decidedAt && (
        <div className="text-[10px] text-white/30 mt-1">{content.decidedAt}</div>
      )}
    </BlockWrapper>
  );
}

// ─── Image ───────────────────────────────────────────────────────

function ImageBlock({ block, readOnly }: BlockRendererProps) {
  const content = block.content as { url: string; alt: string; width?: number; height?: number };

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly} className="p-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={content.url}
        alt={content.alt}
        width={content.width}
        height={content.height}
        className="rounded-md max-w-full h-auto"
      />
      {content.alt && <div className="text-xs text-white/40 mt-1 px-2 pb-1">{content.alt}</div>}
    </BlockWrapper>
  );
}

// ─── File ────────────────────────────────────────────────────────

function FileBlock({ block, readOnly }: BlockRendererProps) {
  const content = block.content as { path: string; language: string };

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly}>
      <div className="flex items-center gap-2">
        <span className="text-white/40 text-sm">📄</span>
        <span className="text-sm font-mono text-white/80">{content.path}</span>
        <span className="text-[10px] text-white/30">{content.language}</span>
      </div>
    </BlockWrapper>
  );
}

// ─── Preview ─────────────────────────────────────────────────────

function PreviewBlock({ block, readOnly }: BlockRendererProps) {
  const content = block.content as { url: string; label: string };

  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly} className="p-0 overflow-hidden">
      <div className="border-b border-white/5 px-3 py-1.5 text-[10px] text-white/40">{content.label}</div>
      <iframe
        src={content.url}
        className="w-full h-64 border-0"
        title={content.label}
        sandbox="allow-scripts allow-same-origin"
      />
    </BlockWrapper>
  );
}

// ─── Unknown ─────────────────────────────────────────────────────

function UnknownBlock({ block, readOnly }: BlockRendererProps) {
  return (
    <BlockWrapper block={block} onDelete={() => {}} readOnly={readOnly}>
      <div className="text-xs text-white/40">
        Unknown block type: {block.type}
      </div>
      <pre className="text-[10px] text-white/30 mt-1 overflow-x-auto">
        {JSON.stringify(block.content, null, 2)}
      </pre>
    </BlockWrapper>
  );
}
