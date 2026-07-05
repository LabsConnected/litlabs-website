import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { callService } from "@/lib/ha-api";
import { executeHATool } from "@/lib/ha-tools";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { domain, service, data = {}, tool, args = {} } = body;

    // Direct service call mode
    if (domain && service) {
      const result = await callService(domain, service, data);
      return NextResponse.json(result);
    }

    // Tool-call mode (LLM-driven)
    if (tool) {
      const result = await executeHATool(tool, args);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Missing 'domain+service' or 'tool' parameter" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
