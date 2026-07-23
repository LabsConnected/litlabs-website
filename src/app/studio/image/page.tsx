"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function StudioImagePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/studio?tool=image");
  }, [router]);
  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center">
      <div className="text-orange-500 animate-pulse text-sm">
        Redirecting to Studio…
      </div>
    </div>
  );
}
