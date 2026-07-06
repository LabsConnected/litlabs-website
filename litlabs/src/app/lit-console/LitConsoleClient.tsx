"use client";

import dynamic from "next/dynamic";

const LitConsole = dynamic(
  () => import("@/components/lit-console/LitConsole"),
  { ssr: false },
);

export default function LitConsoleClient() {
  return <div className="h-full flex flex-col"><LitConsole /></div>;
}
