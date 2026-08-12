import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  getUserFacts,
  upsertUserFact,
  deleteUserFact,
  type FactSource,
} from "@/lib/connectors/user-facts";

// GET /api/settings/user-facts — list all user facts
async function getHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const facts = await getUserFacts(clerkId);
    return NextResponse.json({ facts });
  } catch (err) {
    console.error("[user-facts] GET error:", err);
    return NextResponse.json({ error: "Failed to load facts" }, { status: 500 });
  }
}

// POST /api/settings/user-facts — create or update a fact
async function postHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { key, value, source, confidence, confirmed, metadata } = body as {
      key?: string;
      value?: unknown;
      source?: FactSource;
      confidence?: number;
      confirmed?: boolean;
      metadata?: Record<string, unknown>;
    };

    if (!key || typeof key !== "string") {
      return NextResponse.json({ error: "Missing 'key' field" }, { status: 400 });
    }
    if (value === undefined) {
      return NextResponse.json({ error: "Missing 'value' field" }, { status: 400 });
    }

    const validSources: FactSource[] = [
      "user_explicit",
      "profile",
      "device",
      "connector",
      "conversation",
    ];
    const safeSource = source && validSources.includes(source) ? source : "conversation";
    const safeConfidence =
      typeof confidence === "number" && confidence >= 0 && confidence <= 1
        ? confidence
        : 0.5;

    const fact = await upsertUserFact(clerkId, key, {
      value,
      source: safeSource,
      confidence: safeConfidence,
      confirmed: Boolean(confirmed),
      metadata: metadata ?? {},
    });

    if (!fact) {
      return NextResponse.json({ error: "Failed to save fact" }, { status: 500 });
    }
    return NextResponse.json({ fact });
  } catch (err) {
    console.error("[user-facts] POST error:", err);
    return NextResponse.json({ error: "Failed to save fact" }, { status: 500 });
  }
}

// DELETE /api/settings/user-facts?key=... — delete a fact
async function deleteHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "Missing 'key' parameter" }, { status: 400 });
    }

    const ok = await deleteUserFact(clerkId, key);
    if (!ok) {
      return NextResponse.json({ error: "Failed to delete fact" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[user-facts] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete fact" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler);
export const POST = withRateLimit(postHandler);
export const DELETE = withRateLimit(deleteHandler);
