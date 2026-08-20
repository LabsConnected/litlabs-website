import { Supermemory } from "supermemory";
import { generateText } from "@/lib/llm";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { newRequestId, jsonError } from "@/lib/api-route-helpers";
import { withRateLimit } from "@/lib/rate-limiter";

// ── Route configuration ──────────────────────────────────────────
// Node.js runtime (uses Node-only SDKs). maxDuration gives Railway enough
// headroom for LLM calls; without it, a slow provider triggers a Railway
// 504 HTML page instead of a JSON error.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) return null;
  try {
    return new Supermemory({ apiKey: key });
  } catch {
    return null;
  }
}

async function handler(req: NextRequest) {
  const requestId = newRequestId();
  try {
    const { userId } = await auth(req);
    if (!userId) {
      return jsonError(401, "Authentication required", requestId);
    }
    const uid = userId;

    const { messages, model = "gemini-flash" } = await req.json();
    if (!messages || !messages.length) {
      return jsonError(400, "Messages required", requestId);
    }

    const lastMessage = messages[messages.length - 1]?.content || "";

    let memoryContext = "";
    const sm = getSupermemory();
    if (sm) {
      try {
        const memoryResults = await sm.search.memories({
          q: lastMessage,
          containerTag: uid,
          limit: 8,
        });
        memoryContext = (memoryResults.results || [])
          .map((m: { memory?: string; chunk?: string }) => m.memory || m.chunk)
          .filter(Boolean)
          .join("\n");
      } catch {
        // non-fatal
      }
    }

    const systemPrompt = `You are LiTT, a production-grade code builder assistant for LiTTree LabStudios (litlabs.net).
Generate clean, modern, working code that is immediately useful.

## BRAND CONTEXT
- Product: LiTTree LabStudios — an AI software factory, not a chat app.
- Stack: Next.js 16, React 19, TypeScript, Tailwind CSS v4, Supabase, Clerk, Stripe, Railway.
- Design: Glassmorphic dark theme. Colors: neon green (#a8ff2f), purple (#a970ff), cyan (#00f0ff), black (#03050a).
- Icons: Lucide. No Bootstrap, Material UI, or external CSS frameworks.

## OUTPUT FORMAT
- Always wrap code in triple backticks with the language specified.
- For multi-file output, prefix each code block with a comment line: // filename.ext
- For standalone pages, generate separate files: index.html, styles.css, script.js
- For React, generate: App.tsx, components/, styles/
- For Next.js, generate: src/app/page.tsx, src/app/globals.css

## CODE QUALITY RULES
- Use semantic HTML5 elements (header, nav, main, section, article, footer)
- Modern responsive layout (CSS Grid, Flexbox, clamp() for fluid typography)
- Strong typography with system font stacks (no external Google Fonts in standalone files)
- Accessible contrast (WCAG AA minimum)
- Keyboard focus states (:focus-visible)
- Reduced-motion support: @media (prefers-reduced-motion: reduce)
- No deprecated markup
- No placeholder links using href="#"
- No emoji as primary UI icons — use inline SVG instead
- No inline CSS when generating multiple files (use external styles.css)
- No external dependencies unless justified

## CONTENT RULES (ANTI-BOILERPLATE)
- NEVER use generic placeholder branding like "YourBrand", "Your Company", or "Your App Name"
- NEVER use "Lorem Ipsum", fake pricing, or generic SaaS copy ("Unlock Your Potential", "Transform Your Business")
- NEVER use fake business claims ("24/7 Support", "Join thousands of customers", "Trusted by 500+ companies")
- NEVER use "© 2023" — always use the current year dynamically: new Date().getFullYear()
- If information is unknown, leave a TODO comment — never fabricate content
- Include realistic, production-ready content that makes sense for the actual product

## DESIGN DEFAULTS
- Default to a polished, modern aesthetic with good spacing and hierarchy
- Use CSS custom properties for colors so users can easily rebrand
- Dark mode support via @media (prefers-color-scheme: dark) when appropriate
- Mobile-first responsive design

${memoryContext ? `Relevant context from memory:\n${memoryContext}` : ""}

Be direct, professional, and code-focused. Do not explain the code in prose unless asked.
Output the code files immediately.`;

    const result = await generateText(
      lastMessage,
      { task: "code", category: "code", maxTokens: 8192, timeoutMs: 15_000 },
      systemPrompt,
    );

    // Async save to memory
    if (sm) {
      sm.add({
        content: `User: ${lastMessage}\nAssistant: ${result.text}`,
        containerTag: uid,
        metadata: { type: "canvas-build", model },
      }).catch(() => { });
    }

    return NextResponse.json({
      text: result.text,
      provider: result.provider,
      model: result.model,
      requestId,
    }, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Chat failed";
    return jsonError(500, message, requestId, error);
  }
}

export const POST = withRateLimit(handler, 10, 60);
