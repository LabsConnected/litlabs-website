"use client";

import { use } from "react";
import CapabilityDetailClient from "./CapabilityDetailClient";

export default function CapabilityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  return <CapabilityDetailClient slug={slug} />;
}
