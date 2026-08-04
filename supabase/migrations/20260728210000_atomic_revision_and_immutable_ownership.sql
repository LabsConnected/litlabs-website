-- ============================================
-- Atomic revision handling + immutable ownership
--
-- 1. RPC: try_increment_conversation_revision
--    Atomically checks expected revision and increments it.
--    Returns the new revision on success, NULL on conflict.
--    This prevents concurrent writes from both succeeding.
--
-- 2. Trigger: prevent updating owner_id or project_id on
--    studio_conversations and studio_conversation_messages.
--    These fields are immutable after creation.
-- ============================================

-- ============================================
-- 1. Atomic revision increment RPC
-- ============================================
CREATE OR REPLACE FUNCTION public.try_increment_conversation_revision(
  p_conversation_id uuid,
  p_owner_id text,
  p_expected_revision bigint
)
RETURNS bigint AS $$
DECLARE
  new_revision bigint;
BEGIN
  UPDATE public.studio_conversations
  SET revision = revision + 1
  WHERE id = p_conversation_id
    AND owner_id = p_owner_id
    AND revision = p_expected_revision
  RETURNING revision INTO new_revision;

  RETURN new_revision;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to service_role
GRANT EXECUTE ON FUNCTION public.try_increment_conversation_revision(uuid, text, bigint) TO service_role;

-- ============================================
-- 2. Immutable owner_id / project_id triggers
-- ============================================

-- Conversations: prevent changing owner_id or project_id
CREATE OR REPLACE FUNCTION public.studio_conversations_immutable_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Cannot modify owner_id on studio_conversations (immutable)';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'Cannot modify project_id on studio_conversations (immutable)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_studio_conversations_immutable ON public.studio_conversations;
CREATE TRIGGER trigger_studio_conversations_immutable
  BEFORE UPDATE ON public.studio_conversations
  FOR EACH ROW EXECUTE FUNCTION public.studio_conversations_immutable_fields();

-- Messages: prevent changing owner_id or project_id
CREATE OR REPLACE FUNCTION public.studio_messages_immutable_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Cannot modify owner_id on studio_conversation_messages (immutable)';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'Cannot modify project_id on studio_conversation_messages (immutable)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_studio_messages_immutable ON public.studio_conversation_messages;
CREATE TRIGGER trigger_studio_messages_immutable
  BEFORE UPDATE ON public.studio_conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.studio_messages_immutable_fields();
