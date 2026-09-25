-- Cobrança: uma mensagem por cliente por dia, com o total vencido.
--
-- Antes as duas funções devolviam uma linha por PARCELA e a dunning-cron manda
-- uma mensagem por linha: quem tinha 3 parcelas vencidas recebia 3 mensagens
-- todo dia (caso WILLIANE, de 10/09 a 25/09).
--
-- Agora devolvem uma linha por CLIENTE, no mesmo formato de antes, para a edge
-- function continuar igual (republicar edge function é arriscado neste projeto):
--   id          = parcela mais antiga (a dunning-cron registra o envio nela)
--   amount      = soma das parcelas
--   due_date    = vencimento da mais antiga
--   description = a da parcela, se for só uma; senão "total de N parcelas em
--                 atraso — a mais antiga" (a mensagem fica "pagamento de R$ X
--                 (total de 3 parcelas em atraso — a mais antiga) que venceu em …")
-- Cliente que já recebeu qualquer cobrança hoje não entra de novo, e quem tem
-- parcela vencida não recebe também o lembrete de "vence hoje".

CREATE OR REPLACE FUNCTION public.get_overdue_receivables_to_dunning(p_today date DEFAULT (timezone('America/Sao_Paulo'::text, now()))::date, p_limit integer DEFAULT 50, p_max_dias_vencido integer DEFAULT 180)
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
  ORDER BY u.ultimo_envio ASC NULLS FIRST, p.due_date ASC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.get_due_today_receivables_to_dunning(p_today date DEFAULT (timezone('America/Sao_Paulo'::text, now()))::date, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, amount numeric, due_date date, description text, customer_id uuid, customers jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH hoje AS (
    SELECT ar.id, ar.amount, ar.due_date, ar.description, ar.customer_id, ar.created_at
      FROM public.accounts_receivable ar
      JOIN public.customers c ON c.id = ar.customer_id
     WHERE ar.status = 'pendente'
       AND ar.due_date = p_today
       AND c.phone IS NOT NULL
       AND btrim(c.phone) <> ''
       AND NOT c.dunning_paused
       AND NOT EXISTS (
         SELECT 1 FROM public.ai_blocked_contacts b
          WHERE regexp_replace(b.phone, '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g')
       )
  ),
  por_cliente AS (
    SELECT h.customer_id,
           (array_agg(h.id ORDER BY h.created_at, h.id))[1] AS id,
           (array_agg(h.description ORDER BY h.created_at, h.id))[1] AS primeira_descricao,
           round(sum(h.amount), 2) AS amount,
           count(*) AS n
      FROM hoje h
     GROUP BY h.customer_id
  )
  SELECT
    p.id,
    p.amount,
    p_today AS due_date,
    CASE WHEN p.n = 1 THEN p.primeira_descricao
         ELSE 'total de ' || p.n || ' parcelas' END AS description,
    p.customer_id,
    jsonb_build_object('name', c.name, 'phone', c.phone) AS customers
  FROM por_cliente p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dunning_logs dl
     WHERE dl.customer_id = p.customer_id
       AND dl.sent_at >= p_today::timestamptz
  )
    -- quem tem parcela vencida recebe a cobrança de atraso, não este lembrete
    AND NOT EXISTS (
      SELECT 1 FROM public.accounts_receivable v
       WHERE v.customer_id = p.customer_id
         AND v.status IN ('pendente', 'vencido')
         AND v.due_date < p_today
         AND v.due_date >= p_today - 180
    )
  ORDER BY p.amount DESC
  LIMIT p_limit;
$function$;
