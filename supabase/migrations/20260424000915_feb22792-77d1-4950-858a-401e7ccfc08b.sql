-- Desfazer a última importação de contas a receber (2026-04-24 00:06 UTC)
-- 1) Remover os 93 lançamentos importados
DELETE FROM public.accounts_receivable
WHERE date_trunc('minute', created_at) = '2026-04-24 00:06:00+00';

-- 2) Remover clientes criados naquela importação que não têm nenhum outro vínculo
WITH candidatos AS (
  SELECT id FROM public.customers
  WHERE date_trunc('minute', created_at) = '2026-04-24 00:06:00+00'
)
DELETE FROM public.customers c
USING candidatos
WHERE c.id = candidatos.id
  AND NOT EXISTS (SELECT 1 FROM public.accounts_receivable a WHERE a.customer_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.customer_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations w WHERE w.customer_id = c.id);