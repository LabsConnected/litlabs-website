"use client";

import { useState } from "react";
import {
  BrainCircuit,
  MessageSquareText,
  Layers3,
  CircleCheck,
  ChevronDown,
  Zap,
  Copy,
  Check,
} from "lucide-react";
import {
  BuilderBlock,
  ChatMessageBlock,
  TerminalBlock,
  ImageBlock,
  PlanBlock,
  ProgressBlock,
  ErrorBlock,
  CodeBlock,
  DiffBlock,
  PreviewBlock,
  AgentRunBlock,
  FileBlock,
  ApprovalBlock,
  VideoBlock,
  AudioBlock,
} from "@/app/studio/lib/builder-blocks";
import { LiTTMessageAvatar, UserMessageAvatar } from "@/components/chat/MessageAvatar";
import styles from "./ChatShell.module.css";

interface BuilderStreamProps {
  blocks: BuilderBlock[];
  isSpeaking?: boolean;
  onSpeak?: (text: string) => void;
  stopSpeaking?: () => void;
  onExpandTerminal?: () => void;
  busySeconds?: number;
}

function timeLabel(value?: string | number | Date) {
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
      ? block.output.slice(0, 220) + "…"
      : block.output
    : "";
  return (
    <div className={styles.message}>
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "6px",
            fontSize: "11px",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#9aa6b8",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: statusColor,
              boxShadow: `0 0 8px ${statusColor}`,
            }}
          />
          Terminal · {startedBy} · {block.status}
        </div>
        <div
          style={{
            fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", monospace',
            fontSize: "13px",
            padding: "6px 8px",
            borderRadius: "8px",
            backgroundColor: "#0a0a0f",
            border: "1px solid #1f2937",
            color: "#e6e6f0",
            marginBottom: "8px",
          }}
        >
          <span style={{ color: "#64748b", userSelect: "none" }}>$ </span>
          {block.command}
        </div>
        {outputPreview && (
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", monospace',
              fontSize: "11px",
              color: "#9cb6b2",
              maxHeight: "96px",
              overflow: "auto",
              lineHeight: 1.4,
            }}
          >
            {outputPreview}
          </pre>
        )}
        <div className={styles.messageActions}>
          <button onClick={onExpand}>Expand Terminal</button>
        </div>
      </div>
    </div>
  );
}

function LiTTAvatar({ size = 34 }: { size?: number }) {
  return <LiTTMessageAvatar size={size} />;
}

function UserAvatar({ size = 30 }: { size?: number }) {
  return <UserMessageAvatar size={size} />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className={styles.messageMetaBtn}
      title="Copy"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : "Copy"}
    </button>
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
  const role = block.role === "user" ? "user" : "assistant";
  return (
    <article className={`${styles.message} ${styles[role]}`}>
      {role === "assistant" ? <LiTTAvatar /> : <UserAvatar />}
      <div className={styles.bubble}>
        <div className={`${styles.messageLabel} ${role === "user" ? styles.messageLabelUser : styles.messageLabelAssistant}`}>
          {role === "user" ? "You" : "LiTT"}
          {role === "assistant" && <span className={styles.aiBadge}>AI</span>}
        </div>
        <div className={styles.copy}>{block.content}</div>
        <div className={styles.messageMeta}>
          <span className={styles.messageMetaTime}>{timeLabel(block.createdAt)}</span>
          {role === "assistant" && (
            <>
              <CopyButton text={block.content} />
              <button
                onClick={() =>
                  isSpeaking ? stopSpeaking?.() : onSpeak?.(block.content)
                }
                className={styles.messageMetaBtn}
                aria-label={isSpeaking ? "Stop speaking" : "Speak this message"}
                aria-pressed={isSpeaking}
                title={isSpeaking ? "Stop" : "Read aloud"}
              >
                <Zap size={10} />
                {isSpeaking ? "Stop" : "Speak"}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function ImageBlockView({ block }: { block: ImageBlock }) {
  const isLoading = block.status === "generating";
  const isFailed = block.status === "failed";
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        {block.prompt && (
          <div style={{ fontSize: "12px", color: "#9aa6b8", marginBottom: "8px" }}>
            {block.prompt}
          </div>
        )}
        {isLoading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "24px",
              borderRadius: "12px",
              border: "1px solid #1f2937",
              backgroundColor: "#0a0a0f",
              color: "#9aa6b8",
              fontSize: "13px",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: "2px solid #22d3ee",
                borderTopColor: "transparent",
                animation: "spin 1s linear infinite",
              }}
            />
            Generating with {block.provider || "Free Fast"}…
          </div>
        ) : isFailed ? (
          <div
            style={{
              padding: "16px",
              borderRadius: "12px",
              border: "1px solid #ef444433",
              backgroundColor: "#ef444408",
              color: "#ef4444",
              fontSize: "13px",
            }}
          >
            Generation failed: {block.alt || "Unknown error"}
          </div>
        ) : (
          <div
            style={{
              overflow: "hidden",
              borderRadius: "12px",
              border: "1px solid #1f2937",
              backgroundColor: "#0a0a0f",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={block.url}
              alt={block.alt || block.prompt || "Generated image"}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                maxHeight: "400px",
                objectFit: "contain",
              }}
            />
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
                padding: "8px 12px",
                fontSize: "10px",
                color: "#64748b",
                borderTop: "1px solid #1f2937",
                alignItems: "center",
              }}
            >
              {block.provider && <span>{block.provider}</span>}
              {block.aspectRatio && <span>· {block.aspectRatio}</span>}
              {block.generationTimeMs && (
                <span>· {(block.generationTimeMs / 1000).toFixed(1)}s</span>
              )}
              <div style={{ flex: 1 }} />
              <a
                href={block.url}
                download={`litlabs-${block.id}.png`}
                style={{ color: "#22d3ee", textDecoration: "none" }}
              >
                Download
              </a>
            </div>
          </div>
        )}
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function PlanBlockView({ block }: { block: PlanBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9aa6b8", marginBottom: "8px" }}>
          {block.title || "Plan"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {block.steps.map((step, i) => {
            const done = i < (block.activeStep ?? 0);
            const active = i === (block.activeStep ?? -1);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: done ? "#64748b" : active ? "#22d3ee" : "#9aa6b8" }}>
                <span style={{ width: 14, textAlign: "center" }}>{done ? "✓" : active ? "●" : "○"}</span>
                <span style={{ textDecoration: done ? "line-through" : "none" }}>{step}</span>
              </div>
            );
          })}
        </div>
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function ProgressBlockView({ block }: { block: ProgressBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9aa6b8", marginBottom: "6px" }}>
          {block.title}
        </div>
        <div style={{ height: 6, borderRadius: 3, backgroundColor: "#1f2937", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, block.percent))}%`, backgroundColor: "#22d3ee", transition: "width 0.3s ease" }} />
        </div>
        {block.message && <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>{block.message}</div>}
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function ErrorBlockView({ block }: { block: ErrorBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%", borderColor: "#ef444433" }}>
        <div style={{ fontSize: "13px", color: "#ef4444" }}>{block.content}</div>
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function CodeBlockView({ block }: { block: CodeBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
          <span style={{ fontSize: "11px", fontWeight: 800, color: "#9aa6b8", fontFamily: 'ui-monospace, monospace' }}>{block.file}</span>
          {block.changes && (
            <span style={{ fontSize: "10px", color: "#64748b" }}>
              <span style={{ color: "#22c55e" }}>+{block.changes.added}</span>{" "}
              <span style={{ color: "#ef4444" }}>-{block.changes.removed}</span>
            </span>
          )}
        </div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", monospace', fontSize: "11px", padding: "8px", borderRadius: "8px", backgroundColor: "#0a0a0f", border: "1px solid #1f2937", color: "#e6e6f0", maxHeight: "200px", overflow: "auto", lineHeight: 1.4 }}>
          {block.content}
        </pre>
        <div className={styles.messageActions}>
          <button>Open editor</button>
          <button>View diff</button>
        </div>
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function DiffBlockView({ block }: { block: DiffBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ fontSize: "11px", fontWeight: 800, color: "#9aa6b8", fontFamily: 'ui-monospace, monospace', marginBottom: "6px" }}>
          {block.file}
        </div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", monospace', fontSize: "11px", padding: "8px", borderRadius: "8px", backgroundColor: "#0a0a0f", border: "1px solid #1f2937", color: "#e6e6f0", maxHeight: "200px", overflow: "auto", lineHeight: 1.4 }}>
          {block.patch}
        </pre>
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function PreviewBlockView({ block }: { block: PreviewBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9aa6b8", marginBottom: "6px" }}>
          {block.title || "Live preview"}
        </div>
        <div style={{ overflow: "hidden", borderRadius: "12px", border: "1px solid #1f2937", backgroundColor: "#0a0a0f" }}>
          <iframe src={block.url} className="w-full" style={{ width: "100%", height: "300px", border: "none" }} title={block.title || "Preview"} />
        </div>
        <div className={styles.messageActions}>
          <a href={block.url} target="_blank" rel="noopener noreferrer" style={{ color: "#22d3ee", textDecoration: "none" }}>Expand</a>
          <button>Mobile</button>
          <button>Refresh</button>
        </div>
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function AgentRunBlockView({ block }: { block: AgentRunBlock }) {
  const statusColor = block.status === "complete" ? "#22c55e" : block.status === "error" ? "#ef4444" : "#22d3ee";
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9aa6b8" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: statusColor, boxShadow: `0 0 8px ${statusColor}` }} />
          {block.agent} · {block.status}
        </div>
        <div style={{ fontSize: "13px", color: "#e6e6f0", marginBottom: "6px" }}>{block.task}</div>
        {block.logs && block.logs.length > 0 && (
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: 'ui-monospace, monospace', fontSize: "11px", padding: "6px 8px", borderRadius: "6px", backgroundColor: "#0a0a0f", border: "1px solid #1f2937", color: "#9cb6b2", maxHeight: "120px", overflow: "auto", lineHeight: 1.4 }}>
            {block.logs.join("\n")}
          </pre>
        )}
        {block.result && <div style={{ fontSize: "12px", color: "#9aa6b8", marginTop: "6px" }}>{block.result}</div>}
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function FileBlockView({ block }: { block: FileBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "10px", border: "1px solid #1f2937", backgroundColor: "#0a0a0f" }}>
          <span style={{ fontSize: "20px" }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13px", color: "#e6e6f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.name}</div>
            {block.size && <div style={{ fontSize: "10px", color: "#64748b" }}>{(block.size / 1024).toFixed(1)} KB</div>}
          </div>
          {block.url && <a href={block.url} download={block.name} style={{ color: "#22d3ee", textDecoration: "none", fontSize: "11px" }}>Download</a>}
        </div>
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function ApprovalBlockView({ block }: { block: ApprovalBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%", borderColor: "#fbbf2433" }}>
        <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#fbbf24", marginBottom: "6px" }}>
          Approval needed
        </div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#e6e6f0", marginBottom: "4px" }}>{block.title}</div>
        <div style={{ fontSize: "12px", color: "#9aa6b8", marginBottom: "8px" }}>{block.description}</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button style={{ padding: "6px 14px", borderRadius: "8px", border: "1px solid #22c55e33", backgroundColor: "#22c55e15", color: "#22c55e", fontSize: "12px", fontWeight: 700 }}>
            {block.approved ? "✓ Approved" : "Approve"}
          </button>
          <button style={{ padding: "6px 14px", borderRadius: "8px", border: "1px solid #1f2937", backgroundColor: "transparent", color: "#9aa6b8", fontSize: "12px", fontWeight: 700 }}>
            Decline
          </button>
        </div>
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function VideoBlockView({ block }: { block: VideoBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ overflow: "hidden", borderRadius: "12px", border: "1px solid #1f2937", backgroundColor: "#0a0a0f" }}>
          <video src={block.url} controls style={{ width: "100%", maxHeight: "400px", display: "block" }} />
        </div>
        {block.title && <div style={{ fontSize: "12px", color: "#9aa6b8", marginTop: "6px" }}>{block.title}</div>}
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function AudioBlockView({ block }: { block: AudioBlock }) {
  return (
    <article className={`${styles.message} ${styles.assistant}`}>
      <LiTTAvatar />
      <div className={styles.bubble} style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", border: "1px solid #1f2937", backgroundColor: "#0a0a0f" }}>
          <span style={{ fontSize: "20px" }}>🎵</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {block.title && <div style={{ fontSize: "13px", color: "#e6e6f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.title}</div>}
            <audio src={block.url} controls style={{ width: "100%", height: "32px", marginTop: "4px" }} />
          </div>
        </div>
        <time>{timeLabel(block.timestamp)}</time>
      </div>
    </article>
  );
}

function ActivityTraceView({ busySeconds = 0 }: { busySeconds?: number }) {
  const [open, setOpen] = useState(true);
  const stages = [
    { label: "Understanding your request", detail: "Identifying intent and the best response path", icon: MessageSquareText, at: 0 },
    { label: "Loading conversation context", detail: "Using the messages and attachments available to this run", icon: Layers3, at: 1 },
    { label: "Preparing the response", detail: "Building a clear, useful answer", icon: BrainCircuit, at: 3 },
  ];
  const activeStage = busySeconds >= 3 ? 2 : busySeconds >= 1 ? 1 : 0;
  return (
    <section className={styles.activityTrace}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={styles.activityHeader}>
        <span className={styles.activityIcon}>
          <BrainCircuit size={17} />
          <span className={styles.activityIconDot} />
        </span>
        <span className={styles.activityBody}>
          <span className={styles.activityTitle}>LiTT is working</span>
          <span className={styles.activitySub}>Operational trace · {busySeconds}s</span>
        </span>
        <ChevronDown size={14} className={`${styles.activityChevron} ${open ? styles.activityChevronOpen : ""}`} />
      </button>
      {open && (
        <div className={styles.activityContent}>
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const complete = index < activeStage;
            const active = index === activeStage;
            return (
              <div key={stage.label} className={styles.activityStage} style={{ opacity: index > activeStage ? 0.3 : 1 }}>
                <span className={`${styles.activityStageIcon} ${complete ? styles.activityStageIconComplete : active ? styles.activityStageIconActive : styles.activityStageIconPending}`}>
                  {complete ? <CircleCheck size={13} /> : <Icon size={12} className={active ? "animate-pulse" : ""} />}
                </span>
                <span>
                  <span className={styles.activityStageLabel}>{stage.label}</span>
                  <span className={styles.activityStageDetail}>{stage.detail}</span>
                </span>
                {active && (
                  <span className={styles.activityStageDots}>
                    <i className={styles.activityStageDot} />
                    <i className={styles.activityStageDot} />
                    <i className={styles.activityStageDot} />
                  </span>
                )}
              </div>
            );
          })}
          <p className={styles.activityFooter}>Shows verifiable activity, context, and tool use—not private hidden reasoning.</p>
        </div>
      )}
    </section>
  );
}

export default function BuilderStream({
  blocks,
  isSpeaking,
  onSpeak,
  stopSpeaking,
  onExpandTerminal,
  busySeconds,
}: BuilderStreamProps) {
  return (
    <>
      {blocks.map((block) => {
        switch (block.type) {
          case "chat-message":
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
            return <ActivityTraceView key={block.id} busySeconds={busySeconds} />;
          case "image":
            return <ImageBlockView key={block.id} block={block} />;
          case "plan":
            return <PlanBlockView key={block.id} block={block} />;
          case "progress":
            return <ProgressBlockView key={block.id} block={block} />;
          case "error":
            return <ErrorBlockView key={block.id} block={block} />;
          case "code":
            return <CodeBlockView key={block.id} block={block} />;
          case "diff":
            return <DiffBlockView key={block.id} block={block} />;
          case "preview":
            return <PreviewBlockView key={block.id} block={block} />;
          case "agent-run":
            return <AgentRunBlockView key={block.id} block={block} />;
          case "file":
            return <FileBlockView key={block.id} block={block} />;
          case "approval":
            return <ApprovalBlockView key={block.id} block={block} />;
          case "video":
            return <VideoBlockView key={block.id} block={block} />;
          case "audio":
            return <AudioBlockView key={block.id} block={block} />;
        }
      })}
    </>
  );
}
