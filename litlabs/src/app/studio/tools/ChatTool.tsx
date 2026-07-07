"use client";

import dynamic from "next/dynamic";

const LitConsole = dynamic(
  () => import("@/components/lit-console/LitConsole"),
  { ssr: false },
);

export default function ChatTool() {
  return (
    <div className="h-full w-full">
      <LitConsole />
    </div>
  );
}
