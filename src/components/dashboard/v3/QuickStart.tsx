"use client";

import { CreateExperience } from "@/components/create/CreateExperience";

export function QuickStart({
  initialPrompt,
  initialIntent,
}: {
  initialPrompt?: string;
  initialIntent?: string | null;
}) {
  return <CreateExperience initialPrompt={initialPrompt} initialIntent={initialIntent} />;
}
