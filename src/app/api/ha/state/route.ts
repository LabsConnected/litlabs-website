import { NextRequest, NextResponse } from "next/server";
import { getStates, getState, getDeviceMap } from "@/lib/ha-api";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("entity_id");

  try {
    if (entityId) {
      const state = await getState(entityId);
      if (!state) {
        return NextResponse.json({ error: "Entity not found" }, { status: 404 });
      }
      return NextResponse.json({ entity: state });
    }

    const states = await getStates();
    return NextResponse.json({ entities: states, count: states.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
