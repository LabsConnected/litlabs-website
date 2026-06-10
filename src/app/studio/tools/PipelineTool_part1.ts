"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box, Terminal, Activity, Zap, Play, Cpu, Search, X, Copy, Check,
  Loader2, Settings, Webhook, Database, MessageSquare, Mail,
  Trash2, SlidersHorizontal, Save, Network, RefreshCw, Sparkles,
  Clock, FileJson, Wand2
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────────────── */
type NodeType = "trigger" | "agent" | "action";
type NodeStatus = "idle" | "running" | "completed" | "error";

interface LibraryItem {
  type: NodeType;
  title: string;
  icon: React.ReactNode;
  desc: string;
  keywords: string[];
}

interface PipelineNode {
  id: string;
  type: NodeType;
  title: string;
  config: Record<string, string | number | boolean>;
  status?: NodeStatus;
}

/* ─── Visual Config ─────────────────────────────────────────────────── */
const NODE_META: Record<NodeType, { label: string; color: string; bg: string; border: string; ring: string }> = {
  trigger: { label: "Trigger",  color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30", ring: "ring-amber-500/40" },
  agent:   { label: "AI Agent", color: "text-fuchsia-400", bg: "bg-fuchsia-600/10", border: "border-fuchsia-500/30", ring: "ring-fuchsia-500/40" },
  action:  { label: "Action",   color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", ring: "ring-emerald-500/40" },
};

const LIBRARY: LibraryItem[] = [
  { type: "trigger", title: "Webhook Listener",   icon: <Webhook   className="w-4 h-4" />, desc: "HTTP endpoint trigger",    keywords: ["webhook", "http", "api", "endpoint", "post", "request"] },
  { type: "trigger", title: "Scheduled Interval", icon: <Activity  className="w-4 h-4" />, desc: "Cron-based scheduler",    keywords: ["cron", "schedule", "hourly", "daily", "weekly", "timer", "interval", "periodic"] },
  { type: "agent",   title: "Logic Orchestrator", icon: <Network   className="w-4 h-4" />, desc: "AI routing & analysis",  keywords: ["route", "logic", "analyze", "decide", "orchestrate", "classify"] },
  { type: "agent",   title: "Task Champion",      icon: <Cpu       className="w-4 h-4" />, desc: "LLM reasoning engine",   keywords: ["summarize", "extract", "transform", "generate", "reason", "llm", "gpt"] },
  { type: "action",  title: "Database Insert",    icon: <Database  className="w-4 h-4" />, desc: "Save to LitLabs Ledger", keywords: ["database", "db", "sql", "save", "store", "persist", "ledger", "postgres"] },
  { type: "action",  title: "Discord Webhook",    icon: <MessageSquare className="w-4 h-4" />, desc: "Post to Discord channel", keywords: ["discord", "notify", "alert", "channel", "slack", "message"] },
  { type: "action",  title: "Email Dispatch",     icon: <Mail      className="w-4 h-4" />, desc: "Send email notification", keywords: ["email", "mail", "smtp", "send", "notify"] },
];

/* ─── Default Configs ───────────────────────────────────────────────── */
function defaultConfig(title: string): Record<string, string | number | boolean> {
  switch (title) {
    case "Webhook Listener":   return { endpoint: "/api/v1/ingest", method: "POST", headers: "Content-Type: application/json" };
    case "Scheduled Interval": return { preset: "hourly", cron: "0 * * * *" };
    case "Logic Orchestrator": return { model: "lit-core-v4", temperature: 0.3, prompt: "Analyze input and route to the correct downstream action." };
    case "Task Champion":      return { model: "lit-reason-max", temperature: 0.7, prompt: "Process the input data and produce a structured output." };
    case "Database Insert":    return { table: "pipeline_output", cluster: "primary" };
    case "Discord Webhook":    return { webhook_url: "", message_template: "Pipeline completed: {{status}}" };
    case "Email Dispatch":     return { to: "", subject: "Pipeline Alert", body: "Pipeline finished execution." };
    default: return {};
  }
}

/* ─── YAML Generator ──────────────────────────────────────────────── */
function toYAML(nodes: PipelineNode[]): string {
  const lines: string[] = [
    "# LiTTree Labs Pipeline Protocol",
    `# Generated: ${new Date().toISOString()}`,
    "# https://litlabs.net",
    "",
    "version: \"1.0\"",
    `name: "untitled_pipeline"`,
    `nodes: ${nodes.length}`,
    "",
    "workflow:",
  ];
  nodes.forEach((n, i) => {
    lines.push(`  - id: ${n.id}`, `    type: ${n.type}`, `    title: "${n.title}"`, `    status: ${n.status || "idle"}`);
    if (Object.keys(n.config).length) {
      lines.push("    config:");
      Object.entries(n.config).forEach(([k, v]) => {
        const val = typeof v === "string" ? `"${v.replace(/"/g, "\\\"")}"` : String(v);
        lines.push(`      ${k}: ${val}`);
      });
    }
    if (i < nodes.length - 1) lines.push("    ->");
    lines.push("");
  });
  return lines.join("\n");
}