"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BuilderRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/studio?tool=image");
  }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center font-mono">
      <div className="text-center">
        <div className="text-3xl mb-4 animate-pulse">⚡</div>
        <div>Redirecting to Studio...</div>
      </div>
    </div>
  );
}
