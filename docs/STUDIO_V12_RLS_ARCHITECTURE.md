# Studio V12 — RLS Architecture & Security Model

## Overview

The Studio V12 conversation system uses a **server-only access model**. All database
access is performed through the Supabase service role key, which bypasses RLS.
Client applications never directly query `studio_conversations` or
`studio_conversation_messages`.

## RLS Policies

### studio_conversations

| Policy | Role | Operation | Condition |
|--------|------|-----------|----------|
| `studio_conversations_owner_select` | `authenticated` | SELECT | `false` (denied) |
| `studio_conversations_service_role` | `service_role` | ALL | `true` (full access) |

### studio_conversation_messages

| Policy | Role | Operation | Condition |
|--------|------|-----------|----------|
| `studio_messages_service_role` | `service_role` | ALL | `true` (full access) |

### memories

Uses existing RLS policies from prior migrations. The V12 migration adds columns
(`project_id`, `conversation_id`, `agent_slug`, `memory_type`, `dedupe_key`, `metadata`)
but does not change RLS policies.

## Security Guarantees

1. **Ownership scoping**: All service-layer queries filter by `owner_id` = authenticated
   user's Clerk ID. A user can never read or write another user's conversations or messages.

2. **Project ownership validation**: `createConversation` calls `resolveProject` before
   inserting. If the user doesn't own the project, the conversation is not created.

3. **Immutable ownership fields**: DB triggers prevent modifying `owner_id` or
   `project_id` after creation on both `studio_conversations` and
   `studio_conversation_messages`.

4. **Atomic revision control**: The `try_increment_conversation_revision` RPC atomically
   checks and increments the revision, preventing concurrent writes from both succeeding.

5. **Idempotency**: The `client_request_id` unique index prevents duplicate message
   inserts. Duplicate requests return the existing user message and any associated
   assistant message.

6. **Secret blocking**: The memory service blocks content matching known secret patterns
   (API keys, tokens, private keys) before persisting.

## API Route Security

All API routes under `/api/studio/conversations/`:

1. Call `auth()` to get the Clerk user ID
2. Return 401 if not authenticated
3. Use `getConversation(convId, userId)` which scopes by `owner_id`
4. Return 404 if the conversation doesn't exist or isn't owned by the user
5. Use the service role key for all DB operations

## Client-Side

The `useCanonicalConversation` hook and `useConversationStore` Zustand store manage
optimistic UI state. They never directly access Supabase — all reads and writes go
through the canonical API routes.
