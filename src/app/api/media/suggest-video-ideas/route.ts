import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { withRateLimit } from "@/lib/rate-limiter";
import { auth } from "@/lib/auth";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

interface VideoIdea {
  title: string;
  prompt: string;
  motion: string;
  vibe: string;
}

const IDEA_PROMPT = `You are LiTT, the creative AI director inside LiTTree LabStudios. The user uploaded a photo to the Video Studio and wants ideas for turning it into a short video clip.

Study the photo carefully. Consider:
- The subject, setting, mood, colors, lighting, and composition
- What story or motion could emerge from this single frame
- What would look cinematic and visually striking as a 3-8 second video

Generate 5 creative video ideas that are specific to what you actually see in the photo. Do not give generic ideas — every idea must reference real elements visible in the image. Each prompt should be a vivid, detailed scene description that a video AI model (like Veo or HappyHorse) can use directly.

Return JSON matching this exact shape:
{
  "ideas": [
    {
      "title": "short catchy title (3-5 words)",
      "prompt": "detailed video scene description (2-4 sentences with specific visual details, camera moves, and mood)",
      "motion": "one of: Cinematic, Slow Pan, Zoom In, Tracking Shot, Time Lapse, Handheld, Drone Shot, Orbit",
      "vibe": "one word: Dreamy, Epic, Serene, Gritty, Playful, Noir, Ethereal, Bold, Nostalgic, Futuristic"
    }
  ]
}

Rules:
- Never infer sensitive traits about a person (age, ethnicity, identity, etc.)
- Focus on the scene, setting, light, and creative possibilities
- Make each idea visually distinct from the others
- Vary the motion styles and vibes across ideas`;

async function handler(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });

  try {
    const { imageUrl, imageBytes, mimeType = "image/jpeg" } = await request.json();

    let base64Data: string | null = null;
    let detectedMimeType = mimeType;

    if (imageBytes && typeof imageBytes === "string") {
      base64Data = imageBytes;
    } else if (imageUrl && typeof imageUrl === "string") {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        return NextResponse.json({ error: "Failed to fetch uploaded image" }, { status: 400 });
      }
      const buffer = await imgRes.arrayBuffer();
      base64Data = Buffer.from(buffer).toString("base64");
      detectedMimeType = imgRes.headers.get("content-type")?.split(";")[0] || mimeType;
    }

    if (!base64Data) {
      return NextResponse.json({ error: "Missing imageUrl or imageBytes" }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { inlineData: { data: base64Data, mimeType: detectedMimeType } },
        { text: IDEA_PROMPT },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.9,
      },
    });

    const text = response.text || "";
    let ideas: VideoIdea[] = [];
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.ideas)) {
        ideas = parsed.ideas
          .filter(
            (idea: unknown): idea is VideoIdea =>
              typeof idea === "object" &&
              idea !== null &&
              typeof (idea as VideoIdea).title === "string" &&
              typeof (idea as VideoIdea).prompt === "string",
          )
          .slice(0, 5);
      }
    } catch {
      // JSON parse failure — fall through to error below
    }

    if (ideas.length === 0) {
      return NextResponse.json(
        { error: "Could not generate ideas from this image. Try a clearer or different photo." },
        { status: 422 },
      );
    }

    return NextResponse.json({ ideas });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Idea generation failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 20, 60);
