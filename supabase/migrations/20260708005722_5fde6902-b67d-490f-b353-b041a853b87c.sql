
-- Mescla mensagens de conversas duplicadas para a mais antiga
WITH ranked AS (
  SELECT id, customer_phone,
         FIRST_VALUE(id) OVER (PARTITION BY customer_phone ORDER BY created_at ASC) AS keep_id
  FROM public.whatsapp_conversations
)
UPDATE public.whatsapp_messages m
SET conversation_id = r.keep_id
FROM ranked r
WHERE m.conversation_id = r.id AND r.id <> r.keep_id;

-- Remove conversas duplicadas (mantém a mais antiga por telefone)
WITH ranked AS (
  SELECT id, customer_phone,
         ROW_NUMBER() OVER (PARTITION BY customer_phone ORDER BY created_at ASC) AS rn
  FROM public.whatsapp_conversations
)
DELETE FROM public.whatsapp_conversations
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Índice único para prevenir novas duplicatas
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_customer_phone_key
  ON public.whatsapp_conversations (customer_phone);
