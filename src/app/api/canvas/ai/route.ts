import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateJSON } from "@/lib/llm";
import { rateLimit } from "@/lib/rate-limiter";
import { jsonError, newRequestId } from "@/lib/api-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/canvas/ai
 *
 * Takes the current canvas document state + a user prompt and returns
 * structured mutations that the client can apply (with preview/accept/reject).
 *
 * Request:
 *   {
 *     prompt: string,
 *     document: CanvasDocument,  // current state
 *     selectedNodeId: string | null,
 *     breakpoint: "desktop" | "tablet" | "mobile"
 *   }
 *
 * Response:
 *   {
 *     reply: string,             // human-readable summary
 *     actions: CanvasMutation[]  // structured mutations to apply
 *   }
 *
 * CanvasMutation types:
 *   - { type: "addSection", template: "hero"|"features"|"pricing"|"cta"|"footer"|"testimonials"|"navbar", afterNodeId?: string }
 *   - { type: "replaceNode", nodeId: string, node: Partial<CanvasNode> }
 *   - { type: "editText", nodeId: string, text: string }
 *   - { type: "editStyles", nodeId: string, styles: Partial<NodeStyles> }
 *   - { type: "deleteNode", nodeId: string }
 *   - { type: "reorder", nodeId: string, direction: "up"|"down" }
 *   - { type: "duplicateNode", nodeId: string }
 */

interface CanvasMutation {
  type: "addSection" | "replaceNode" | "editText" | "editStyles" | "deleteNode" | "reorder" | "duplicateNode";
  nodeId?: string;
  text?: string;
  styles?: Record<string, unknown>;
  template?: string;
  node?: Record<string, unknown>;
  direction?: "up" | "down";
  afterNodeId?: string;
  label: string; // human-readable description for the change log
}

async function handler(req: NextRequest) {
  const requestId = newRequestId();
  const { userId } = await auth(req);
  if (!userId) {
    return jsonError(401, "Authentication required", requestId);
  }

  const rateLimitResult = await rateLimit(req, 20, 60); // 20 per minute
  if (!rateLimitResult.success) {
    return jsonError(429, "Rate limit exceeded", requestId);
  }

  let body: {
    prompt: string;
    document: Record<string, unknown>;
    selectedNodeId: string | null;
    breakpoint: string;
  };

  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON", requestId);
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return jsonError(400, "Prompt required", requestId);
  }

  // Build a compact summary of the canvas for the LLM
  const doc = body.document;
  const nodes = (doc.nodes as Record<string, Record<string, unknown>>) ?? {};
  const rootNodeIds = (doc.rootNodeIds as string[]) ?? [];
  const route = (doc.route as string) ?? "/";

  // Serialize the tree into a compact outline
  function serializeNode(nodeId: string, depth: number): string {
    const node = nodes[nodeId];
    if (!node) return "";
    const indent = "  ".repeat(depth);
    const type = node.type as string;
    const text = (node.props as Record<string, unknown>)?.text as string | undefined;
    const label = text ? ` "${text.slice(0, 50)}"` : "";
    const children = (node.children as string[]) ?? [];
    const childLines = children.map((c) => serializeNode(c, depth + 1)).filter(Boolean).join("\n");
    return `${indent}- ${type}${label}${childLines ? "\n" + childLines : ""}`;
  }

  const treeOutline = rootNodeIds.map((r) => serializeNode(r, 0)).join("\n");

  // Selected node context
  const selectedId = body.selectedNodeId;
  const selectedNode = selectedId ? nodes[selectedId] : null;
  const selectedContext = selectedNode
    ? `Selected node: ${selectedNode.type} (id: ${selectedId})` +
      ((selectedNode.props as Record<string, unknown>)?.text
        ? ` text="${((selectedNode.props as Record<string, unknown>).text as string).slice(0, 100)}"`
        : "")
    : "No node selected (page-level action)";

  const systemPrompt = `You are LiTT, an AI co-pilot inside a visual canvas builder for LiTTree Lab Studios.

You receive the current page structure and a user request. You must respond with:
1. A brief human-readable reply explaining what you'll do
2. A list of structured mutations (actions) that the client will apply

Available section templates: hero, features, pricing, cta, footer, testimonials, navbar, about, contact, gallery, faq, stats, logos, banner

Available mutation types:
- addSection: { type: "addSection", template: "hero", afterNodeId: "node-xxx", label: "Add hero section" }
- editText: { type: "editText", nodeId: "node-xxx", text: "New text", label: "Rewrite heading" }
- editStyles: { type: "editStyles", nodeId: "node-xxx", styles: { fontSize: 32, color: "#fff" }, label: "Make heading bigger" }
- deleteNode: { type: "deleteNode", nodeId: "node-xxx", label: "Remove duplicate CTA" }
- reorder: { type: "reorder", nodeId: "node-xxx", direction: "up"|"down", label: "Move section up" }
- duplicateNode: { type: "duplicateNode", nodeId: "node-xxx", label: "Duplicate card" }

Rules:
- Always include a "label" field with a short human-readable description
- For addSection, use afterNodeId to specify where (omit to append at end)
- For editStyles, only include the style properties you want to change
- Be specific and actionable — don't be vague
- If the request is ambiguous, make a reasonable choice and explain it in the reply
- Keep replies concise (1-3 sentences)
- Return VALID JSON only, no markdown fences`;

  const userPrompt = `Page route: ${route}
Breakpoint: ${body.breakpoint}
${selectedContext}

Current page structure:
${treeOutline || "(empty page)"}

User request: ${body.prompt}

Respond with JSON: { "reply": "...", "actions": [...] }`;

  try {
    const result = await generateJSON(
      userPrompt,
      { task: "json", category: "auto" },
      systemPrompt,
    );

    // Validate the response shape
    const reply = (result as Record<string, unknown>).reply as string ?? "I'll make those changes.";
    const actions = (result as Record<string, unknown>).actions as CanvasMutation[] ?? [];

    // Basic validation of each action
    const validActions = actions.filter((a) => a && a.type && a.label);

    return NextResponse.json({
      reply,
      actions: validActions,
      requestId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI request failed";
    console.error("[canvas-ai] Error:", msg);
    return jsonError(500, `LiTT couldn't process that request: ${msg}`, requestId);
  }
}

export const POST = handler;
