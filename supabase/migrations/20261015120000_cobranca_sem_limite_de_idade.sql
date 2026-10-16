-- Cobrança sem corte por idade da dívida.
--
-- O limite de 180 dias existia como regra anti-spam e deixava de fora dívidas
-- antigas: a RAIANE MENDONÇA ROSA, com 3 parcelas de 2025 (R$ 1.676,00, entre
-- 406 e 468 dias de atraso), não entrava em nenhuma rodada. Eram 4 clientes e
-- R$ 8.079,54 parados por esse motivo.
--
-- A loja decidiu cobrar todos. O valor deixa de cortar na seleção aqui, e o
-- mesmo corte foi retirado do código da dunning-cron (que também conferia por
-- conta própria e ainda passava 180 nesta chamada).
CREATE OR REPLACE FUNCTION public.get_overdue_receivables_to_dunning(
  p_today date DEFAULT (timezone('America/Sao_Paulo'::text, now()))::date,
  p_limit integer DEFAULT 50,
  p_max_dias_vencido integer DEFAULT 36500
)
 RETURNS TABLE(id uuid, amount numeric, due_date date, description text, customer_id uuid, customers jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH vencidas AS (
    SELECT ar.id, ar.amount, ar.due_date, ar.description, ar.customer_id, ar.created_at
      FROM public.accounts_receivable ar
      JOIN public.customers c ON c.id = ar.customer_id
     WHERE ar.status = 'vencido'
       AND c.phone IS NOT NULL
       AND btrim(c.phone) <> ''
       AND NOT c.dunning_paused
       AND ar.due_date < p_today
       AND ar.due_date >= p_today - p_max_dias_vencido
       AND NOT EXISTS (
         SELECT 1 FROM public.ai_blocked_contacts b
          WHERE regexp_replace(b.phone, '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g')
       )
  ),
  por_cliente AS (
    SELECT v.customer_id,
           (array_agg(v.id ORDER BY v.due_date, v.created_at, v.id))[1] AS id,
           (array_agg(v.description ORDER BY v.due_date, v.created_at, v.id))[1] AS primeira_descricao,
           round(sum(v.amount), 2) AS amount,
           min(v.due_date) AS due_date,
           count(*) AS n
      FROM vencidas v
     GROUP BY v.customer_id
  )
  SELECT
    p.id,
    p.amount,
    p.due_date,
    CASE WHEN p.n = 1 THEN p.primeira_descricao
         ELSE 'total de ' || p.n || ' parcelas em atraso — a mais antiga' END AS description,
    p.customer_id,
    jsonb_build_object('name', c.name, 'phone', c.phone) AS customers
  FROM por_cliente p
  JOIN public.customers c ON c.id = p.customer_id
  LEFT JOIN LATERAL (
    SELECT max(dl.sent_at) AS ultimo_envio
      FROM public.dunning_logs dl
     WHERE dl.customer_id = p.customer_id
  ) u ON true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dunning_logs dl
     WHERE dl.customer_id = p.customer_id
       AND dl.sent_at >= p_today::timestamptz
  )
    -- Quem avisou pagamento nas últimas 48h continua de fora.
    AND NOT public.cliente_avisou_pagamento(p.customer_id)
  ORDER BY u.ultimo_envio ASC NULLS FIRST, p.due_date ASC
  LIMIT p_limit;
$function$;
