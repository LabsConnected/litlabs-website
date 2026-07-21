// API Route: Agent-to-agent messaging compatibility wrapper
import { NextRequest } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  handleUnifiedChat,
  type UnifiedChatRequest,
} from "@/lib/chat/handleUnifiedChat";

async function handler(req: NextRequest) {
  const body = (await req.json()) as UnifiedChatRequest;
  return handleUnifiedChat({ request: req, body });
}

export const POST = withRateLimit(handler, 60, 60);
