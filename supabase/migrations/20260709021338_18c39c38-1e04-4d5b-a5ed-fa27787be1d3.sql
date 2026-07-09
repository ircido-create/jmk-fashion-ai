CREATE OR REPLACE FUNCTION public.bump_conversation_unread(conv_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.whatsapp_conversations
     SET unread_count = COALESCE(unread_count, 0) + 1,
         last_message_at = now()
   WHERE id = conv_id;
$$;
GRANT EXECUTE ON FUNCTION public.bump_conversation_unread(uuid) TO authenticated, service_role;