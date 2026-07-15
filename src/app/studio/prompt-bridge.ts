"use client";

import { useEffect } from "react";

export type StudioPromptTarget =
  | "image"
  | "video"
  | "audio"
  | "flow"
  | "pipeline"
  | "agents"
  | "canvas";

export type StudioPromptEvent = {
  target: StudioPromptTarget;
  prompt: string;
  source: "chat-drawer" | "launcher" | "external";
  ts: number;
};

const CHANNEL = "litlabs:studio-prompt";

export function dispatchStudioPrompt(
  target: StudioPromptTarget,
  prompt: string,
  source: StudioPromptEvent["source"] = "chat-drawer",
): void {
  if (typeof window === "undefined") return;
  const payload: StudioPromptEvent = { target, prompt, source, ts: Date.now() };
  window.dispatchEvent(new CustomEvent<StudioPromptEvent>(CHANNEL, { detail: payload }));
}

export function useStudioPrompt(
  target: StudioPromptTarget,
  onPrompt: (prompt: string, ev: StudioPromptEvent) => void,
): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<StudioPromptEvent>).detail;
      if (detail?.target === target) onPrompt(detail.prompt, detail);
    };
    window.addEventListener(CHANNEL, handler);
    return () => window.removeEventListener(CHANNEL, handler);
  }, [target, onPrompt]);
}

// Intent classifier — light heuristic, no API call. Lets the chat drawer route
// media requests to the right tool instead of always producing code.
export function classifyPromptIntent(
  text: string,
): { target: StudioPromptTarget; cleaned: string } | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  const has = (kw: string[]) => kw.some((k) => t.includes(k));

  if (has(["image of", "picture of", "draw ", "render an image", "generate an image", "generate a picture", "photo of", "illustration of", "artwork of", "painting of"])) {
    return { target: "image", cleaned: stripLeading(text, ["generate an image of", "image of", "picture of", "draw", "render an image of"]) };
  }
  if (has(["video of", "animate ", "clip of", "generate a video", "generate video", "movie of", "scene of"])) {
    return { target: "video", cleaned: stripLeading(text, ["generate a video of", "video of", "animate", "clip of"]) };
  }
  if (has(["song ", "music ", "beat ", "melody", "track ", "audio of", "generate music", "generate a song", "generate audio", "compose"])) {
    return { target: "audio", cleaned: stripLeading(text, ["generate a song", "generate music", "generate audio", "song", "music", "track", "compose"]) };
  }
  if (has(["flow for", "workflow for", "chain", "build a flow"])) {
    return { target: "flow", cleaned: stripLeading(text, ["build a flow", "flow for", "workflow for"]) };
  }
  if (has(["pipeline for", "orchestrate"])) {
    return { target: "pipeline", cleaned: stripLeading(text, ["pipeline for", "orchestrate"]) };
  }
  return null;
}

function stripLeading(text: string, phrases: string[]): string {
  const lower = text.toLowerCase();
  for (const p of phrases) {
    const i = lower.indexOf(p);
    if (i === 0) return text.slice(p.length).replace(/^[\s,:-]+/, "").trim();
  }
  return text.trim();
}
