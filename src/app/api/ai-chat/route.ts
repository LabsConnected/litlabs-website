import { Supermemory } from "supermemory";
import { generateText } from "@/lib/llm";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) return null;
  try {
    return new Supermemory({ apiKey: key });
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    const uid = userId || "anonymous";

    const { messages, model = "gemini-flash" } = await req.json();
    if (!messages || !messages.length) {
      return NextResponse.json({ error: "Messages required" }, { status: 400 });
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

    const systemPrompt = `You are LiTT, a production-grade code builder assistant for LiTTree LabStudios.
Generate clean, modern, working code that is immediately useful.

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

## CONTENT RULES
- NEVER use generic placeholder branding like "YourBrand" or "Your Company"
- NEVER use "© 2023" — always use the current year dynamically: new Date().getFullYear()
- NEVER use fake business claims ("24/7 Support", "Join thousands of customers", "Trusted by 500+ companies")
- NEVER use generic SaaS copy ("Unlock Your Potential", "Transform Your Business")
- Use neutral, editable placeholders that make sense: "Your App Name", descriptive section titles
- Include realistic but clearly editable content
- Use inline SVG icons for features (no emoji)

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
      { task: "code", category: "code", maxTokens: 8192 },
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
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
