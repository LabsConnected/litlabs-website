"use client";

import {
  type BuilderBlock,
  type ChatMessageBlock,
  type TerminalBlock,
} from "@/app/studio/types/builder-blocks";

interface BuilderStreamProps {
  blocks: BuilderBlock[];
  isSpeaking?: boolean;
  onSpeak?: (text: string) => void;
  stopSpeaking?: () => void;
  onExpandTerminal?: () => void;
}

function timeLabel(value?: number) {
  if (!value) return "Now";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function TerminalBlockView({
  block,
  onExpand,
}: {
  block: TerminalBlock;
  onExpand?: () => void;
}) {
  const startedBy = block.startedBy === "user" ? "You" : "LiTT";
  const statusColor =
    block.status === "success"
      ? "#22c55e"
      : block.status === "failed"
        ? "#ef4444"
        : block.status === "running"
          ? "#22d3ee"
          : block.status === "queued"
            ? "#fbbf24"
            : "#64748b";
  const outputPreview = block.output
    ? block.output.length > 220
      ? block.output.slice(0, 220) + "\u2026"
      : block.output
    : "";
  return (
    <div className="px-3 py-2">
      <div
        className="w-full rounded-xl border p-3"
        style={{
          backgroundColor: "var(--studio-card)",
          borderColor: "var(--studio-border-strong)",
        }}
      >
        <div
          className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider"
          style={{ color: "#9aa6b8" }}
        >
          <span
            className="inline-block h-[7px] w-[7px] rounded-full"
            style={{
              backgroundColor: statusColor,
              boxShadow: `0 0 8px ${statusColor}`,
            }}
          />
          Terminal &middot; {startedBy} &middot; {block.status}
        </div>
        <div
          className="mb-2 rounded-lg border border-white/10 bg-[#0a0a0f] p-1.5 font-mono text-[13px] text-[#e6e6f0]"
        >
          <span className="select-none text-gray-500">$ </span>
          {block.command}
        </div>
        {outputPreview && (
          <pre
            className="m-0 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed"
            style={{ color: "#9cb6b2" }}
          >
            {outputPreview}
          </pre>
        )}
        {onExpand && (
          <button
            onClick={onExpand}
            className="mt-1 text-[10px] font-bold text-cyan-300 transition hover:text-cyan-200"
          >
            Expand Terminal
          </button>
        )}
      </div>
    </div>
  );
}

function ChatMessageBlockView({
  block,
  isSpeaking,
  onSpeak,
  stopSpeaking,
}: {
  block: ChatMessageBlock;
  isSpeaking?: boolean;
  onSpeak?: (text: string) => void;
  stopSpeaking?: () => void;
}) {
  const isUser = block.role === "user";
  return (
    <article
      className={`flex gap-2.5 px-3 py-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {!isUser && (
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm">
          {"\u2726"}
        </div>
      )}
      <div
        className={`flex max-w-[85%] flex-col gap-1 rounded-xl border p-2.5 text-sm ${
          isUser
            ? "items-end border-cyan-400/20 bg-cyan-400/5"
            : "border-white/10 bg-white/5"
        }`}
        style={{ backgroundColor: "var(--studio-card)" }}
      >
        <div className="whitespace-pre-wrap break-words text-white/90">
          {block.content}
        </div>
        <time className="text-[10px] text-white/40">
          {timeLabel(block.createdAt)}
        </time>
        {!isUser && (onSpeak || stopSpeaking) && (
          <div className="flex gap-2">
            <button
              onClick={() =>
                isSpeaking ? stopSpeaking?.() : onSpeak?.(block.content)
              }
              className="text-[10px] font-bold text-cyan-300 transition hover:text-cyan-200"
              aria-label={isSpeaking ? "Stop speaking" : "Speak this message"}
              aria-pressed={isSpeaking}
            >
              {isSpeaking ? "\u25a0 Stop" : "\u25c6 Speak"}
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(block.content)}
              className="text-[10px] font-bold text-white/50 transition hover:text-white/80"
              aria-label="Copy message to clipboard"
            >
              Copy
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function ThinkingBlockView({ content }: { content?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-white/50">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" />
      </span>
      {content || "LiTT is working"}
    </div>
  );
}

function MediaBlockView({
  block,
}: {
  block: Extract<BuilderBlock, { type: "image" | "video" | "audio" }>;
}) {
  return (
    <div className="px-3 py-2">
      <div className="max-w-[720px] rounded-xl border border-white/10 bg-white/5 p-3">
        {block.type === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={block.url}
            alt={block.alt || "Generated image"}
            className="max-h-[520px] w-full rounded-xl object-contain"
          />
        )}
        {block.type === "video" && (
          <video src={block.url} controls className="w-full rounded-xl" />
        )}
        {block.type === "audio" && (
          <audio src={block.url} controls className="w-full" />
        )}
        <div className="mt-2 flex gap-3">
          <a
            href={block.url}
            download
            className="text-[10px] font-bold text-cyan-300 transition hover:text-cyan-200"
          >
            Download
          </a>
          {block.type === "image" && (
            <button
              onClick={() =>
                navigator.clipboard.writeText(block.prompt || block.alt || "")
              }
              className="text-[10px] font-bold text-white/50 transition hover:text-white/80"
            >
              Reuse prompt
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BuilderStream({
  blocks,
  isSpeaking,
  onSpeak,
  stopSpeaking,
  onExpandTerminal,
}: BuilderStreamProps) {
  return (
    <>
      {blocks.map((block) => {
        switch (block.type) {
          case "message":
            return (
              <ChatMessageBlockView
                key={block.id}
                block={block}
                isSpeaking={isSpeaking}
                onSpeak={onSpeak}
                stopSpeaking={stopSpeaking}
              />
            );
          case "terminal":
            return (
              <TerminalBlockView
                key={block.id}
                block={block}
                onExpand={onExpandTerminal}
              />
            );
          case "thinking":
            return <ThinkingBlockView key={block.id} content={block.content} />;
          case "image":
          case "video":
          case "audio":
            return <MediaBlockView key={block.id} block={block} />;
          default:
            // Unrecognized blocks are rendered as a compact placeholder.
            return (
              <div key={block.id} className="px-3 py-2 opacity-60">
                <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-sm text-white/60">
                  [{block.type}] block renderer not implemented yet
                </div>
              </div>
            );
        }
      })}
    </>
  );
}
