import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { CapabilitySummary } from "@/lib/capabilities/types";

export const runtime = "nodejs";

async function handler() {
  const { userId } = await auth().catch(() => ({ userId: null }));

  const capabilities: CapabilitySummary = {
    capabilities: [
      {
        id: "auth",
        name: "Authentication",
        status: userId ? "ready" : "unavailable",
        lastVerifiedAt: new Date().toISOString(),
      },
      {
        id: "repository",
        name: "Repository",
        status: "not_configured",
        lastVerifiedAt: new Date().toISOString(),
      },
      {
        id: "runtime.sandbox",
        name: "Workspace",
        status: "not_configured",
        lastVerifiedAt: new Date().toISOString(),
      },
    ],
    readiness: [],
  };

  return NextResponse.json(capabilities);
}

export const GET = handler;
