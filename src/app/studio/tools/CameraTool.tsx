"use client";

import { useEffect, useState } from "react";
import CameraSession from "../components/CameraSession";

export default function CameraTool() {
  const [snapshot, setSnapshot] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      setSnapshot(null);
    };
  }, []);
  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
      <CameraSession
        modelName="Gemini 2.5 Flash Vision"
        onSnapshot={(dataUrl) => setSnapshot(dataUrl)}
        onClose={() => setSnapshot(null)}
      />
      {snapshot && (
        <div className="shrink-0 border-t border-white/10 p-2">
          <img src={snapshot} alt="snapshot" className="w-full rounded-xl border border-white/10" />
        </div>
      )}
    </div>
  );
}
