-- Pausa de cobrança por cliente (24/09/2026).
--
-- O único jeito de tirar alguém da cobrança automática era ai_blocked_contacts,
-- que também cala a Mônica para o contato (chave PIX etc.). A pausa aqui só
-- tira a cliente da cobrança diária (dunning-cron), enquanto um pagamento ou
-- parcela está em conferência. Primeiro uso: Francineia, pedido 6892 com três
-- parcelas no mesmo vencimento.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS dunning_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dunning_pause_note text;

CREATE OR REPLACE FUNCTION public.get_overdue_receivables_to_dunning(p_today date DEFAULT (timezone('America/Sao_Paulo'::text, now()))::date, p_limit integer DEFAULT 50, p_max_dias_vencido integer DEFAULT 180)
 RETURNS TABLE(id uuid, amount numeric, due_date date, description text, customer_id uuid, customers jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    ar.id,
    ar.amount,
    ar.due_date,
    ar.description,
    ar.customer_id,
    jsonb_build_object('name', c.name, 'phone', c.phone) AS customers
  FROM public.accounts_receivable ar
  JOIN public.customers c ON c.id = ar.customer_id
  LEFT JOIN LATERAL (
    SELECT max(dl.sent_at) AS ultimo_envio
    FROM public.dunning_logs dl
    WHERE dl.receivable_id = ar.id
  ) u ON true
  WHERE ar.status = 'vencido'
    AND c.phone IS NOT NULL
    AND btrim(c.phone) <> ''
    AND NOT c.dunning_paused
    AND ar.due_date < p_today
    AND ar.due_date >= p_today - p_max_dias_vencido
    AND NOT EXISTS (
      SELECT 1 FROM public.dunning_logs dl
       WHERE dl.receivable_id = ar.id
         AND dl.sent_at >= p_today::timestamptz
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_blocked_contacts b
       WHERE regexp_replace(b.phone, '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g')
    )
  ORDER BY u.ultimo_envio ASC NULLS FIRST, ar.due_date ASC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.get_due_today_receivables_to_dunning(p_today date DEFAULT (timezone('America/Sao_Paulo'::text, now()))::date, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, amount numeric, due_date date, description text, customer_id uuid, customers jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    ar.id,
    ar.amount,
    ar.due_date,
    ar.description,
    ar.customer_id,
    jsonb_build_object('name', c.name, 'phone', c.phone) AS customers
  FROM public.accounts_receivable ar
  JOIN public.customers c ON c.id = ar.customer_id
  WHERE ar.status = 'pendente'
    AND ar.due_date = p_today
    AND c.phone IS NOT NULL
    AND btrim(c.phone) <> ''
    AND NOT c.dunning_paused
    AND NOT EXISTS (
      SELECT 1 FROM public.dunning_logs dl
       WHERE dl.receivable_id = ar.id
         AND dl.sent_at >= p_today::timestamptz
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_blocked_contacts b
       WHERE regexp_replace(b.phone, '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g')
    )
  ORDER BY ar.amount DESC
  LIMIT p_limit;
$function$;
