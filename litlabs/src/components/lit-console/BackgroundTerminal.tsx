"use client";

import { LC } from "./lit-console-theme";

const lines = [
  "$ git status",
  "On branch main",
  "Your branch is up to date with 'origin/main'.",
  "",
  "$ pnpm dev",
  "▶ next dev --webpack",
  "ready - started server on 0.0.0.0:3000",
  "event - compiled client successfully in 412 ms",
  "",
  "[agent] Director: planning task",
  "[agent] Coder: reading src/app/page.tsx",
  "[tool] read_file: src/components/TopBar.tsx",
  "[tool] edit_file: applied 1 change",
  "[agent] Director: task complete",
];

export default function BackgroundTerminal() {
  return (
    <div
      className="pointer-events-none fixed inset-0 select-none overflow-hidden"
      style={{ backgroundColor: LC.bg, zIndex: 0 }}
    >
      <div
        className="absolute inset-0 p-8 pt-24 text-xs leading-5"
        style={{
          color: LC.textDim,
          opacity: 0.25,
          fontFamily: LC.fontMono,
          filter: "blur(0.5px)",
        }}
      >
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-96"
        style={{ background: `linear-gradient(to top, ${LC.bg}, transparent)` }}
      />
    </div>
  );
}
