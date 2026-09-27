"use client";

import type { WorkspaceObject } from "@/lib/studio/workspace-document";

const COPY: Record<string, string> = {
  terminal: "A terminal window appears here when a real session is attached.",
  file: "A file window appears here when a real path is attached.",
  preview: "A preview window appears here when a real preview URL is attached.",
  artifact: "An artifact window appears here when a real artifact is attached.",
};

export function DeferredObjectBody({ object }: { object: WorkspaceObject }) {
  const sessionId = object.payload.sessionId;
  const path = object.payload.path;
  const url = object.payload.url;
  const artifactId = object.payload.artifactId;
  const real = [sessionId, path, url, artifactId].find((value) => typeof value === "string" && value);
  return (
    <div className="p-3 text-[12px] leading-5 text-white/60">
      <p>{COPY[object.type] ?? "This window has no live body yet."}</p>
      {real ? <p className="mt-2 text-white/80">{String(real)}</p> : <p className="mt-2">Nothing is attached.</p>}
    </div>
  );
}
