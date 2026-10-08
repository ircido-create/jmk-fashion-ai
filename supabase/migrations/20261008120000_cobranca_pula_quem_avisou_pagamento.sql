-- Cobrança não insiste com quem avisou que pagou.
--
-- Caso real (KEILA DOS SANTOS REGIS, 06/10/2026 22:00): a cliente escreveu
-- "Acabei de fazer o pagamento desse mês" e que não conseguia enviar o
-- comprovante. Na manhã seguinte, às 10:00, a cobrança automática mandou o
-- lembrete dos R$ 163,00 mesmo assim.
--
-- A regra fica no banco, nas funções que escolhem quem cobrar, para valer
-- também na cobrança manual e não exigir republicar edge function.

-- Reconhece aviso de pagamento nas últimas horas: mensagem recebida da cliente
-- (fora de grupo) ou comprovante registrado. As frases negativas ficam de fora
-- de propósito — "vou pagar", "não paguei", "posso pagar dia 15" não contam.
CREATE OR REPLACE FUNCTION public.cliente_avisou_pagamento(
  p_customer_id uuid,
  p_horas int DEFAULT 48,
  p_ref timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH janela AS (SELECT p_ref - make_interval(hours => p_horas) AS desde),
  msg AS (
    SELECT translate(lower(m.content),
             'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') AS txt
      FROM public.whatsapp_messages m
      JOIN public.whatsapp_conversations c ON c.id = m.conversation_id
      JOIN public.customers cu ON cu.id = p_customer_id
      CROSS JOIN janela j
     WHERE m.direction = 'inbound'
       AND m.created_at >= j.desde AND m.created_at <= p_ref
       AND m.content IS NOT NULL
       -- Nem toda conversa tem o vínculo com o cadastro; o telefone cobre o resto.
       AND (c.customer_id = p_customer_id
            OR right(regexp_replace(c.customer_phone, '\D', '', 'g'), 11)
               = right(regexp_replace(cu.phone, '\D', '', 'g'), 11))
       AND c.customer_phone NOT LIKE '%@g.us'
  )
  SELECT
    EXISTS (
      SELECT 1 FROM msg
       WHERE (
               txt ~ '\m(ja\s+)?paguei\M'
            OR txt ~ '\macabei\s+de\s+(pagar|fazer|efetuar|realizar|mandar|enviar)\M'
            OR txt ~ '\m(fiz|faco|efetuei|realizei|fechei)\s+(o\s+|a\s+)?(pagamento|pix|deposito|transferencia)\M'
            OR txt ~ '\m(mandei|enviei|segue|mandando|enviando)\s+(o\s+|a\s+)?(comprovante|pix|deposito)\M'
            OR txt ~ '\mcomprovante\s+(em\s+)?anexo\M'
            OR txt ~ '\m(pagamento|pix|deposito)\s+(feito|realizado|efetuado|enviado|concluido)\M'
            OR txt ~ '\m(ta|esta|foi|ja\s+esta)\s+pago\M'
            OR txt ~ '\m(depositei|transferi)\M'
             )
         AND NOT (
               txt ~ '\m(nao|ainda\s+nao)\s+(paguei|consegui|deu\s+pra\s+pagar)\M'
            OR txt ~ '\mvou\s+(pagar|fazer|efetuar|realizar|depositar|mandar|enviar)\M'
            OR txt ~ '\m(posso|poderia|consigo|da\s+pra)\s+pagar\M'
            OR txt ~ '\mquando\s+(eu\s+)?(pago|pagar)\M'
            OR txt ~ '\mesqueci\s+de\s+pagar\M'
            OR txt ~ '\mso\s+(vou|consigo)\s+pagar\M'
             )
    )
    OR EXISTS (
      SELECT 1 FROM public.payment_proofs pp CROSS JOIN janela j
       WHERE pp.customer_id = p_customer_id
         AND pp.created_at >= j.desde AND pp.created_at <= p_ref
    );
$function$;

REVOKE ALL ON FUNCTION public.cliente_avisou_pagamento(uuid, int, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.cliente_avisou_pagamento(uuid, int, timestamptz) TO authenticated, service_role;

-- As duas funções abaixo são as de produção, com uma única linha nova cada:
-- AND NOT public.cliente_avisou_pagamento(p.customer_id)

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
    AND NOT EXISTS (
      SELECT 1 FROM public.accounts_receivable v
       WHERE v.customer_id = p.customer_id
         AND v.status IN ('pendente', 'vencido')
         AND v.due_date < p_today
         AND v.due_date >= p_today - 180
    )
    -- Cliente que avisou pagamento (ou mandou comprovante) nas ultimas 48h nao
    -- e cobrada: evita cobrar quem ja pagou e so falta a baixa.
    AND NOT public.cliente_avisou_pagamento(p.customer_id)
  ORDER BY p.amount DESC
  LIMIT p_limit;
$function$;

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
    -- Mesma regra da cobranca do dia: quem avisou pagamento nas ultimas 48h fica de fora.
    AND NOT public.cliente_avisou_pagamento(p.customer_id)
  ORDER BY u.ultimo_envio ASC NULLS FIRST, p.due_date ASC
  LIMIT p_limit;
$function$;
