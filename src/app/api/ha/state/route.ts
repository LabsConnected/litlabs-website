import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getStates, getState } from "@/lib/ha-api";
import { sanitizeProviderError } from "@/lib/provider-error";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("entity_id");

  try {
    if (entityId) {
      const state = await getState(entityId);
      if (!state) {
        return NextResponse.json(
          { error: "Entity not found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ entity: state });
    }

    const states = await getStates();
    return NextResponse.json({ entities: states, count: states.length });
  } catch (err) {
    console.error("[api/ha/state] error:", err);
    const { status, error: msg } = sanitizeProviderError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
