// LiT Actions — background execution for Studio tools from the LiT Dock
// These let LiT actually *do* things, not just navigate.

export type LiTAction =
  | { type: "navigate"; path: string }
  | { type: "generate_image"; prompt: string; aspectRatio?: string; provider?: string }
  | { type: "generate_audio"; prompt: string; duration?: number }
  | { type: "build_app"; prompt: string }
  | { type: "create_agent"; prompt: string };

export type LiTActionResult = {
  ok: boolean;
  message: string;
  url?: string;
  images?: Array<{ url: string; prompt: string; provider: string }>;
  error?: string;
  action?: LiTAction;
};

export function actionFromIntent(
  text: string,
  intent: { route: { path: string; label: string } | null; confidence: number; isAmbiguous: boolean },
): LiTAction | null {
  if (intent.isAmbiguous || !intent.route) return null;

  const lower = text.toLowerCase().trim();

  // Image generation — any image intent that asks to "make", "generate", "create"
  if (intent.route.path.startsWith("/studio?tool=image")) {
    const imageKeywords = ["make", "generate", "create", "draw", "design", "image", "picture", "wallpaper", "logo", "art"];
    if (imageKeywords.some((k) => lower.includes(k))) {
      return {
        type: "generate_image",
        prompt: text,
        aspectRatio: lower.includes("wallpaper") || lower.includes("16:9") ? "16:9" : "1:1",
        provider: "pollinations",
      };
    }
  }

  // Audio generation
  if (intent.route.path.startsWith("/studio?tool=audio")) {
    const audioKeywords = ["make", "generate", "create", "beat", "song", "music", "track"];
    if (audioKeywords.some((k) => lower.includes(k))) {
      return { type: "generate_audio", prompt: text };
    }
  }

  const agentKeywords = ["create agent", "make agent", "agent dna", "custom agent"];
  if (intent.route.path.startsWith("/studio?tool=chat") && agentKeywords.some((k) => lower.includes(k))) {
    return { type: "create_agent", prompt: text };
  }

  const buildKeywords = ["build", "create", "make", "app", "website", "landing page", "component"];
  if (intent.route.path.startsWith("/studio?tool=chat") && buildKeywords.some((k) => lower.includes(k))) {
    return { type: "build_app", prompt: text };
  }

  return { type: "navigate", path: intent.route.path };
}

export async function executeAction(action: LiTAction): Promise<LiTActionResult> {
  switch (action.type) {
    case "navigate":
      return {
        ok: true,
        message: "Opening now.",
        action,
      };

    case "generate_image": {
      try {
        const res = await fetch("/api/studio/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: action.prompt,
            provider: action.provider || "pollinations",
            aspectRatio: action.aspectRatio || "1:1",
            batchSize: 1,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          return { ok: false, message: "Image generation failed.", error: data.error || "Unknown error", action };
        }
        const images = data.images || [];
        return {
          ok: true,
          message: images.length ? "Generated your image." : "Image ready.",
          images,
          url: images[0]?.url,
          action,
        };
      } catch (e) {
        return { ok: false, message: "Image generation failed.", error: e instanceof Error ? e.message : "Network error", action };
      }
    }

    case "generate_audio": {
      // Placeholder — wire to audio API when ready
      return {
        ok: true,
        message: "I can generate audio in the Studio. Opening Audio Studio now.",
        action,
      };
    }

    case "build_app": {
      return {
        ok: true,
        message: "Opening LiTT CODE to start your app.",
        action,
      };
    }

    case "create_agent": {
      return {
        ok: true,
        message: "Opening LiTT CODE to create your agent.",
        action,
      };
    }

    default:
      return { ok: false, message: "Unknown action.", action };
  }
}

export function actionMessage(action: LiTAction): string {
  switch (action.type) {
    case "generate_image":
      return "Generating your image with the standard model...";
    case "generate_audio":
      return "Opening the Audio Studio...";
    case "build_app":
      return "Opening LiTT CODE...";
    case "create_agent":
      return "Opening LiTT CODE...";
    case "navigate":
      return "Opening...";
    default:
      return "Working on it...";
  }
}
