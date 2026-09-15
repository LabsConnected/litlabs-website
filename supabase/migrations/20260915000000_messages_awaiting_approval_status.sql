-- Allow 'awaiting_approval' on studio_conversation_messages.status.
-- The V2 agent loop persists this status when a run pauses at an ACT-mode
-- approval gate; the original CHECK predates that state, so the update was
-- rejected and paused messages stayed 'streaming' forever (which also hid
-- the approval card after a page reload until the rehydration path was
-- fixed to key off agent_paused_runs instead).

ALTER TABLE public.studio_conversation_messages
  DROP CONSTRAINT IF EXISTS studio_conversation_messages_status_check;

ALTER TABLE public.studio_conversation_messages
  ADD CONSTRAINT studio_conversation_messages_status_check
  CHECK (status IN ('pending', 'streaming', 'completed', 'failed', 'cancelled', 'awaiting_approval'));
