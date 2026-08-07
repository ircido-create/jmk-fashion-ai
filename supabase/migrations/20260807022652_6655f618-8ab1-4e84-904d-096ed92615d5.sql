CREATE INDEX IF NOT EXISTS idx_wa_messages_conv_created ON public.whatsapp_messages (conversation_id, created_at DESC);

ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS last_message_preview text;

UPDATE public.whatsapp_conversations c
SET last_message_preview = m.content
FROM (
  SELECT DISTINCT ON (conversation_id) conversation_id, content
  FROM public.whatsapp_messages
  ORDER BY conversation_id, created_at DESC
) m
WHERE m.conversation_id = c.id;

CREATE OR REPLACE FUNCTION public.sync_conversation_preview()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_conversations
     SET last_message_preview = NEW.content,
         last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conversation_preview ON public.whatsapp_messages;
CREATE TRIGGER trg_sync_conversation_preview
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_preview();