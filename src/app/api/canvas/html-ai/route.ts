import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateJSON } from "@/lib/llm";
import { rateLimit } from "@/lib/rate-limiter";
import { jsonError, newRequestId } from "@/lib/api-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/canvas/html-ai
 *
 * Takes the current HTML project files + a user prompt and returns
 * updated file contents. LiTT reads the existing HTML/CSS/JS, understands
 * the request, and returns the new file contents for the client to apply.
 *
 * Request:
 *   {
 *     prompt: string,
 *     files: [{ name: string, content: string, language: string }],
 *     consoleErrors?: string[]  // runtime errors from the preview iframe
 *   }
 *
 * Response:
 *   {
 *     reply: string,
 *     files: [{ name: string, content: string }]
 *   }
 */

interface HtmlFileInput {
  name: string;
  content: string;
  language: string;
}

async function handler(req: NextRequest) {
  const requestId = newRequestId();
  const { userId } = await auth(req);
  if (!userId) {
    return jsonError(401, "Authentication required", requestId);
  }

  const rateLimitResult = await rateLimit(req, 20, 60);
  if (!rateLimitResult.success) {
    return jsonError(429, "Rate limit exceeded", requestId);
  }

  let body: {
    prompt: string;
    files: HtmlFileInput[];
    consoleErrors?: string[];
  };

  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON", requestId);
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return jsonError(400, "Prompt required", requestId);
  }

  if (!body.files || !Array.isArray(body.files)) {
    return jsonError(400, "Files array required", requestId);
  }

  // Build the file context for the LLM
  const fileContext = body.files
    .map((f) => `--- ${f.name} ---\n${f.content}`)
    .join("\n\n");

  const errorContext = body.consoleErrors && body.consoleErrors.length > 0
    ? `\n\nConsole errors from the preview:\n${body.consoleErrors.map((e) => `- ${e}`).join("\n")}\n`
    : "";

  const systemPrompt = `You are LiTT, an AI co-pilot inside an HTML/CSS/JS project builder for LiTTree Lab Studios.

You receive the current project files and a user request. You must respond with:
1. A brief human-readable reply explaining what you'll do (1-3 sentences)
2. The COMPLETE updated contents of any files that need to change

Rules:
- Return ONLY files that need to be modified — don't include unchanged files
- Each file's content must be the COMPLETE file content, not a diff or patch
- Keep the same file names (index.html, style.css, script.js)
- Write clean, modern, well-structured code
- For HTML: use semantic elements, proper meta tags, link to style.css and script.js
- For CSS: use modern CSS (flexbox, grid, custom properties), make it responsive
- For JS: use modern ES6+, add event listeners, keep it clean and readable
- If the user asks to fix errors, address the specific console errors provided
- If the request is ambiguous, make a reasonable choice and explain it in the reply
- Return VALID JSON only, no markdown fences

Response format:
{
  "reply": "Brief explanation of what you did",
  "files": [
    { "name": "index.html", "content": "<!DOCTYPE html>..." },
    { "name": "style.css", "content": "..." }
  ]
}`;

  const userPrompt = `Current project files:
${fileContext}${errorContext}

User request: ${body.prompt}

Respond with JSON: { "reply": "...", "files": [...] }`;

  try {
    const result = await generateJSON(
      userPrompt,
      { task: "json", category: "auto" },
      systemPrompt,
    );

    const reply = (result as Record<string, unknown>).reply as string ?? "Done.";
    const files = (result as Record<string, unknown>).files as Array<{ name: string; content: string }> ?? [];

    // Validate returned files
    const validFiles = files.filter(
      (f) => f && typeof f.name === "string" && typeof f.content === "string",
    );

    return NextResponse.json({
      reply,
      files: validFiles,
      requestId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI request failed";
    return jsonError(500, `LiTT couldn't process that request: ${msg}`, requestId);
  }
}

export const POST = handler;
