"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SocialRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[60vh] text-sm opacity-50">
      Redirecting to Community Feed...
    </div>
  );
}

