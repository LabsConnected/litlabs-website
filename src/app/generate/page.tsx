"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GenerateRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/studio?tool=image");
  }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center font-mono text-sm opacity-50">
      Redirecting to Studio...
    </div>
  );
}

