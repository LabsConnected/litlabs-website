"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { BentoCard } from "@/components/site/BentoCard";
import { TrendingUp } from "lucide-react";

const SocialFeed = dynamic(() => import("@/components/SocialFeed"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12 opacity-50">
      <div className="text-sm">Loading social feed...</div>
    </div>
  ),
});

export function SocialFeedWidget() {
  return (
    <BentoCard title="Live Feed" icon={<TrendingUp size={14} />}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12 opacity-50">
            <div className="text-sm">Loading social feed...</div>
          </div>
        }
      >
        <div className="-mx-2">
          <SocialFeed embedded />
        </div>
      </Suspense>
    </BentoCard>
  );
}
