/**
 * Canonical entry point for the unified chat pipeline.
 *
 * Import from here instead of directly from `app/api/chat/unified/route.ts`
 * so route files and compatibility wrappers share one implementation.
 */

export {
  handleUnifiedChat,
  type UnifiedChatRequest,
} from "@/app/api/chat/unified/route";
