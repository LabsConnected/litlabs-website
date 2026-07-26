"use client";

/**
 * DemoBootstrap — public, unauthenticated demo mode for the Studio.
 *
 * Activated by appending `?demo=1` to any Studio route (e.g. `/studio?demo=1`).
 *
 * It does two things:
 *   1. Monkey-patches `window.fetch` to return realistic mock data for the
 *      handful of internal endpoints the Studio components already call.
 *      The rest of the UI is left completely untouched — the reviewer sees
 *      the real components rendering with mock data flowing through the
 *      same hooks a real signed-in user would have.
 *   2. Renders a persistent, dismissable DEMO banner across the top of the
 *      Studio so the experience is always clearly labeled.
 *
 * In demo mode:
 *   - Auth gate is bypassed by `src/app/studio/page.tsx`.
 *   - Wallet returns 500 LBC.
 *   - Connection summary shows 3 services "connected" (mock).
 *   - Chat sends return a streamed canned response (no real LLM call).
 *   - Terminal / camera / screen tools are inert and explain why.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Public hook: lets any component ask "are we in demo mode?"
// ---------------------------------------------------------------------------

let _demoActive = false;
export function isDemoMode(): boolean {
  return _demoActive;
}

export default function DemoBootstrap() {
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Mark demo-active on first mount (client only). This is the single source
  // of truth for "demo mode" — it is set BEFORE any child useEffect runs that
  // might want to read it.
  useEffect(() => {
    _demoActive = true;
    setMounted(true);
    return () => {
      _demoActive = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch interception — installed only on the client, only in demo mode.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch.bind(window);
    const findDemoAnswer = (text: string) =>
      demoAnswers.find((entry) => entry.match.test(text)) ?? demoAnswers[0];

    window.fetch = async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      const method = (init?.method ?? "GET").toUpperCase();

      // Wallet: 500 LBC.
      if (url.includes("/api/wallet") && method === "GET") {
        return jsonResponse({
          balance: 500,
          last_claim_date: new Date().toISOString(),
        });
      }
      if (url.includes("/api/wallet") && method === "POST") {
        return jsonResponse({ balance: 500, claimed: 0 });
      }

      // Capabilities: 3 mock providers "ready" so the Studio is visibly alive.
      if (url.includes("/api/capabilities") && !url.includes("project-terminal")) {
        return jsonResponse({
          capabilities: [
            { id: "repository", status: "ready", label: "Demo repo" },
            { id: "ai-models", status: "ready", label: "Demo model router" },
            { id: "media-engine", status: "ready", label: "Demo media engine" },
          ],
        });
      }

      // Terminal capability: disconnected in demo (no real PTY).
      if (url.includes("/api/capabilities/project-terminal")) {
        return jsonResponse({
          terminalStatus: "disconnected",
          sessionId: null,
        });
      }

      // Chat: return a canned JSON answer shaped like the real /api/gemini/chat
      // payload. No real LLM call. We delay slightly so the chat UI's "busy"
      // / thinking affordances are visible.
      if (url.includes("/api/gemini/chat") || url.includes("/api/chat/unified")) {
        return jsonChatResponse(init, findDemoAnswer);
      }

      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  if (!mounted || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="demo-banner"
      className="pointer-events-auto fixed inset-x-0 top-0 z-[2147483647] flex h-9 items-center justify-center gap-3 border-b border-amber-300/30 bg-gradient-to-r from-amber-500/95 via-orange-500/95 to-amber-500/95 px-3 text-[12px] font-black text-black shadow-[0_4px_20px_rgba(0,0,0,0.45)]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <Sparkles size={13} className="shrink-0" />
      <span className="truncate uppercase tracking-[0.18em]">
        DEMO MODE · Read-only preview · No real LLM or device access
      </span>
      <Link
        href="/sign-up"
        className="ml-2 hidden shrink-0 rounded-full border border-black/30 bg-black/15 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-black transition hover:bg-black/30 sm:inline-block"
      >
        Sign up free
      </Link>
      <Link
        href="/sign-in?redirect_url=/studio"
        className="ml-1 hidden shrink-0 rounded-full border border-black/40 bg-black px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-white transition hover:bg-black/85 sm:inline-block"
      >
        Sign in
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Hide demo banner"
        title="Hide banner (still in demo mode)"
        className="ml-1 grid h-6 w-6 place-items-center rounded-full text-black/70 transition hover:bg-black/15 hover:text-black"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Returns a canned JSON chat response. The Studio's ChatTool calls
 * `response.json()` and looks for `response | text | message | content`, so
 * we shape the body to match. We add a ~600ms delay so the chat UI's
 * "thinking" affordances engage.
 */
async function jsonChatResponse(
  init: RequestInit | undefined,
  findAnswer: (text: string) => { reply: string },
): Promise<Response> {
  let promptText = "";
  try {
    const cloned = init?.body;
    if (typeof cloned === "string") {
      const parsed = JSON.parse(cloned);
      promptText = String(parsed.message ?? parsed.prompt ?? "");
    }
  } catch {
    // ignore — fall back to default answer
  }

  await new Promise((r) => setTimeout(r, 600));
  const { reply } = findAnswer(promptText);

  return jsonResponse({
    response: reply,
    text: reply,
    message: reply,
    content: reply,
    demo: true,
    usedFallbackModel: undefined,
  });
}

// ---------------------------------------------------------------------------
// Canned answers — chosen by regex against the user's prompt.
// ---------------------------------------------------------------------------

const demoAnswers: { match: RegExp; reply: string }[] = [
  {
    match: /image|picture|draw|illustrat|photo/i,
    reply:
      "Here's what an image request would look like in real Studio:\n\n" +
      "• The `Image` tool in the left rail opens a generation workspace.\n" +
      "• Models include FLUX, Imagen, and Ideogram (BYOK on the **Pro** plan).\n" +
      "• Each generation burns LiTBit Coins — you start with 500.\n" +
      "• Outputs stream into your Assets library and can be remixed.\n\n" +
      "_This is a demo response — sign in to actually generate._",
  },
  {
    match: /video|movie|animate|clip/i,
    reply:
      "Video in real Studio runs on the `Video` tool (rail → 2):\n\n" +
      "• Text-to-video and image-to-video workflows.\n" +
      "• Output renders to MP4 in the right-side LiTT panel.\n" +
      "• Long jobs run on a background worker — you'll get a notification.\n\n" +
      "_Demo only — sign in to render real video._",
  },
  {
    match: /code|build|app|site|deploy|component/i,
    reply:
      "The `Build` tool (rail → B) is the code workspace:\n\n" +
      "• Edit files in a Monaco-powered editor with AI autocomplete.\n" +
      "• LiTT can refactor, write tests, and open PRs on your GitHub repo.\n" +
      "• The PTY (terminal) at the bottom runs your `pnpm dev` / `vercel deploy`.\n\n" +
      "_In demo mode the terminal and GitHub are inert — sign in to connect._",
  },
  {
    match: /agent|spark|crew|persona/i,
    reply:
      "You can switch between agents any time using the chip row in the chat header.\n\n" +
      "• **LiTT** — the operating agent, plans and ships.\n" +
      "• **Spark** — the creative agent, explores directions and ideas.\n\n" +
      "More crew members unlock as your projects grow.",
  },
  {
    match: /terminal|prompt|shell|bash|powershell/i,
    reply:
      "The `Terminal` tool (rail → 6) opens a real PTY in your browser.\n\n" +
      "• It runs in a sandboxed Docker container on our terminal server.\n" +
      "• Commands like `pnpm dev`, `git status`, and `vercel deploy` work out of the box.\n\n" +
      "_Demo mode disables the PTY for safety — sign in to get a live shell._",
  },
  {
    match: /camera|mic|microphone|voice|speak/i,
    reply:
      "Voice and camera in real Studio:\n\n" +
      "• **Voice** uses Inworld TTS + your browser's microphone for live turn-taking.\n" +
      "• **Camera** captures frames for the multimodal composer.\n" +
      "• Both are opt-in and require a real session — demo mode keeps them off.",
  },
  {
    match: /mobile|phone|responsive/i,
    reply:
      "The Studio is fully responsive. On phones, the tool rail collapses into a bottom tab bar and the right-side LiTT panel slides in as a sheet. The composer, transcript, and session drawer all adapt.",
  },
  {
    match: /pricing|plan|cost|credit|coin|lbc|litbit/i,
    reply:
      "LiTTree is free to join, with 500 starter LiTBit Coins.\n\n" +
      "• BYOK models are free (you bring the API key).\n" +
      "• Hosted models and image / video generation spend Coins.\n" +
      "• Daily check-in refills a small amount each day.\n\n" +
      "No card required to start.",
  },
  {
    match: /^\/?(help|what|how|hi|hello|hey)\b/i,
    reply:
      "Welcome to the LiTTree Studio demo! 👋\n\n" +
      "Things to try:\n\n" +
      "1. Click through the tools in the left rail — **Chat**, **Image**, **Build**, **Agents**.\n" +
      "2. Resize the window or open on mobile to see the responsive layout.\n" +
      "3. Click the **model chip** in the top bar to see the model picker.\n" +
      "4. Try `/help` in chat for builder commands.\n\n" +
      "Type **'tell me about images'** or **'how does the build tool work'** to see tailored answers.",
  },
];
