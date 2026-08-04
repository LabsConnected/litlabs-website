/**
 * Canvas action detection — parse user messages and LiTT responses
 * to detect canvas-related intents and propose ArtifactActions.
 *
 * Three behaviors per the blueprint:
 * 1. Explicit creation — user says "make notes", "open in canvas", etc.
 *    → return canvas.create action immediately.
 * 2. Confident continuation — user is working in an active canvas and
 *    says "make the hero darker" → return canvas.update_block action.
 * 3. Suggested action — general answer that could become useful work
 *    → return a suggested canvas.create action (shown as a chip, not
 *      executed automatically).
 *
 * This module is pure — it does not execute actions, only proposes them.
 * The caller (chat API or client) decides whether to execute.
 */

import type { ArtifactAction, BlockType, CanvasType } from "@/lib/canvas/types";

// ─── Intent patterns ─────────────────────────────────────────────

interface IntentPattern {
  regex: RegExp;
  type: "explicit-create" | "explicit-append" | "explicit-update" | "suggested";
  build: (match: RegExpMatchArray, context: ActionContext) => ArtifactAction | null;
}

interface ActionContext {
  activeCanvasId: string | null;
  message: string;
}

// ─── Canvas type inference ───────────────────────────────────────

function inferCanvasType(message: string): CanvasType {
  const lower = message.toLowerCase();
  if (/\b(website|landing|homepage|web\s*page|site)\b/.test(lower)) return "website";
  if (/\b(code|function|component|api|script|class|react|typescript)\b/.test(lower)) return "code";
  if (/\b(research|cite|source|study|analyze)\b/.test(lower)) return "research";
  if (/\b(marketing|campaign|ad|brand|positioning|audience)\b/.test(lower)) return "marketing";
  if (/\b(plan|roadmap|milestone|sprint|strategy|timeline)\b/.test(lower)) return "planning";
  if (/\b(note|notes|summary|summarize|write\s*down)\b/.test(lower)) return "notes";
  return "document";
}

// ─── Block builders ──────────────────────────────────────────────

function buildHeadingBlock(text: string): { type: BlockType; content: Record<string, unknown> } {
  return { type: "heading", content: { text, level: 2 } };
}

function buildParagraphBlock(text: string): { type: BlockType; content: Record<string, unknown> } {
  return { type: "paragraph", content: { text } };
}

function buildChecklistBlock(items: string[]): { type: BlockType; content: Record<string, unknown> } {
  return {
    type: "checklist",
    content: {
      items: items.map((text) => ({
        id: crypto.randomUUID(),
        text,
        checked: false,
      })),
    },
  };
}

function _buildTaskBlock(title: string, description: string): { type: BlockType; content: Record<string, unknown> } {
  return {
    type: "task",
    content: { title, description, status: "todo", taskId: null },
  };
}

function buildCodeBlock(code: string, language: string, filename?: string): { type: BlockType; content: Record<string, unknown> } {
  return { type: "code", content: { language, code, filename } };
}

function _buildDecisionBlock(title: string, rationale: string): { type: BlockType; content: Record<string, unknown> } {
  return { type: "decision", content: { title, rationale } };
}

// ─── Patterns ────────────────────────────────────────────────────

const PATTERNS: IntentPattern[] = [
  // Explicit: "open in canvas", "open this in canvas"
  {
    regex: /\bopen\s+(?:this\s+)?(?:in\s+)?canvas\b/i,
    type: "explicit-create",
    build: (_m, ctx) => ({
      type: "canvas.create",
      title: deriveTitle(ctx.message) || "New Canvas",
      canvasType: inferCanvasType(ctx.message),
      initialBlocks: [buildParagraphBlock(ctx.message)],
    }),
  },
  // Explicit: "make notes", "take notes", "create notes"
  {
    regex: /\b(?:make|take|create)\s+notes\b/i,
    type: "explicit-create",
    build: (_m, _ctx) => ({
      type: "canvas.create",
      title: "Notes",
      canvasType: "notes",
      initialBlocks: [buildHeadingBlock("Notes")],
    }),
  },
  // Explicit: "create a checklist", "make a checklist", "turn into checklist"
  {
    regex: /\b(?:create|make|turn\s+into)\s+(?:a\s+)?checklist\b/i,
    type: "explicit-create",
    build: (_m, _ctx) => ({
      type: "canvas.create",
      title: "Checklist",
      canvasType: "notes",
      initialBlocks: [buildHeadingBlock("Checklist"), buildChecklistBlock([])],
    }),
  },
  // Explicit: "create tasks", "turn into tasks", "make tasks"
  {
    regex: /\b(?:create|make|turn\s+into)\s+(?:the\s+)?tasks?\b/i,
    type: "explicit-create",
    build: (_m, _ctx) => ({
      type: "canvas.create",
      title: "Tasks",
      canvasType: "planning",
      initialBlocks: [buildHeadingBlock("Tasks")],
    }),
  },
  // Explicit: "build the homepage", "create the landing page"
  {
    regex: /\b(?:build|create|design|make)\s+(?:the\s+)?(?:homepage|landing\s*page|website)\b/i,
    type: "explicit-create",
    build: (m, _ctx) => ({
      type: "canvas.create",
      title: m[0].replace(/^(build|create|design|make)\s+(the\s+)?/i, "").replace(/\b$/i, ""),
      canvasType: "website",
      initialBlocks: [
        buildHeadingBlock("Website Canvas"),
        buildParagraphBlock("Requirements and design direction for the website."),
      ],
    }),
  },
  // Explicit append: "add this to canvas", "add to the canvas"
  {
    regex: /\badd\s+(?:this\s+)?to\s+(?:the\s+)?canvas\b/i,
    type: "explicit-append",
    build: (_m, ctx) => {
      if (!ctx.activeCanvasId) return null;
      return {
        type: "canvas.append",
        canvasId: ctx.activeCanvasId,
        blocks: [buildParagraphBlock(ctx.message)],
      };
    },
  },
  // Explicit: "turn into project", "promote to project"
  {
    regex: /\b(?:turn\s+into|promote\s+to|make\s+(?:it\s+)?a)\s+project\b/i,
    type: "explicit-create",
    build: (_m, ctx) => {
      if (!ctx.activeCanvasId) return null;
      return { type: "project.promote", canvasId: ctx.activeCanvasId };
    },
  },
];

// ─── Title derivation ────────────────────────────────────────────

function deriveTitle(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 50) return trimmed;
  // Take first sentence or first 50 chars
  const sentence = trimmed.match(/^[^.!?]+/);
  if (sentence && sentence[0].length <= 60) return sentence[0].trim();
  return trimmed.slice(0, 50).trim() + "...";
}

// ─── Main detection function ─────────────────────────────────────

/**
 * Detect canvas actions from a user message.
 *
 * @param message The user's message
 * @param activeCanvasId The currently active canvas (if any)
 * @returns Array of proposed actions. Empty if no canvas intent detected.
 *          Explicit intents return actions ready to execute.
 *          Suggested intents return actions to show as chips.
 */
export function detectCanvasActions(
  message: string,
  activeCanvasId: string | null,
): ArtifactAction[] {
  const ctx: ActionContext = { activeCanvasId, message };
  const actions: ArtifactAction[] = [];

  for (const pattern of PATTERNS) {
    const match = message.match(pattern.regex);
    if (match) {
      const action = pattern.build(match, ctx);
      if (action) actions.push(action);
    }
  }

  return actions;
}

/**
 * Detect suggested actions from a LiTT response.
 *
 * This is the "suggested action" behavior — LiTT answered normally,
 * but the response contains content that could become useful work
 * (code blocks, lists, decisions). We propose a canvas.create action
 * that the user can click to open in Canvas.
 *
 * @param response The LiTT response text
 * @returns Array of suggested actions (not auto-executed)
 */
export function detectSuggestedActions(response: string): ArtifactAction[] {
  const suggestions: ArtifactAction[] = [];

  // If response contains a code block, suggest opening in a code canvas
  const codeBlock = response.match(/```(\w+)?\n([\s\S]*?)```/);
  if (codeBlock) {
    const language = codeBlock[1] || "text";
    const code = codeBlock[2];
    suggestions.push({
      type: "canvas.create",
      title: "Code Snippet",
      canvasType: "code",
      initialBlocks: [buildCodeBlock(code, language)],
    });
  }

  // If response contains a markdown checklist (- [ ] items), suggest a checklist canvas
  const checklistItems = response.match(/^- \[[ x]\] .+$/gm);
  if (checklistItems && checklistItems.length >= 2) {
    const items = checklistItems.map((line) =>
      line.replace(/^- \[[ x]\]\s*/, "").trim(),
    );
    suggestions.push({
      type: "canvas.create",
      title: "Checklist",
      canvasType: "notes",
      initialBlocks: [buildHeadingBlock("Checklist"), buildChecklistBlock(items)],
    });
  }

  // If response is long (>500 chars) and structured, suggest notes canvas
  if (response.length > 500 && !suggestions.length) {
    suggestions.push({
      type: "canvas.create",
      title: "Notes",
      canvasType: "notes",
      initialBlocks: [buildHeadingBlock("Notes"), buildParagraphBlock(response.slice(0, 1000))],
    });
  }

  return suggestions;
}
