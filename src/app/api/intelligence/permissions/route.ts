import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  grantCapability,
  revokeCapability,
} from "@/lib/litt-intelligence/permission-gate";
import type { CapabilityId } from "@/lib/connectors/provider-registry";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, capability, provider } = body as {
      action: "grant" | "revoke";
      capability: CapabilityId;
      provider?: string;
    };

    if (!action || !capability) {
      return NextResponse.json(
        { error: "Missing action or capability" },
        { status: 400 },
      );
    }

    if (action === "grant") {
      if (!provider) {
        return NextResponse.json(
          { error: "Missing provider for grant" },
          { status: 400 },
        );
      }
      const ok = await grantCapability(userId, capability, provider);
      return NextResponse.json({ success: ok });
    }

    if (action === "revoke") {
      const ok = await revokeCapability(userId, capability);
      return NextResponse.json({ success: ok });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
