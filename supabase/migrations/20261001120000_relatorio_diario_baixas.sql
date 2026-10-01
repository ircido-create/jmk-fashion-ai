-- Relatório diário das baixas, enviado por e-mail (função relatorio-baixas).
--
-- relatorio_baixas_dia(dia) devolve, em JSON, todas as baixas lançadas naquele
-- dia (horário de Brasília) — automáticas (comprovante do WhatsApp) e manuais —
-- e os comprovantes que chegaram no dia e ficaram aguardando baixa manual.
-- O agendamento chama a função às 07:00 com o dia anterior inteiro.

CREATE OR REPLACE FUNCTION public.relatorio_baixas_dia(p_dia date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH l AS (
    SELECT rp.created_at, rp.amount_paid, rp.proof_id,
           ar.description, ar.due_date, ar.status AS ar_status, ar.amount AS ar_amount,
           c.name AS cliente,
           coalesce(p.settlement_status, 'manual') AS tipo,
           p.payment_date, p.ai_payer_name
      FROM public.receivable_payments rp
      JOIN public.accounts_receivable ar ON ar.id = rp.receivable_id
      LEFT JOIN public.customers c ON c.id = ar.customer_id
      JOIN public.payment_proofs p ON p.id = rp.proof_id
     WHERE (rp.created_at AT TIME ZONE 'America/Sao_Paulo')::date = p_dia
  ),
  pend AS (
    SELECT p.created_at, p.ai_amount, p.ai_payer_name, p.settlement_note, c.name AS cliente
      FROM public.payment_proofs p
      LEFT JOIN public.customers c ON c.id = p.customer_id
     WHERE (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date = p_dia
       AND p.settlement_status = 'pendente'
  )
  SELECT jsonb_build_object(
    'dia', p_dia,
    'baixas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'hora', to_char(l.created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
               'tipo', CASE WHEN l.tipo = 'auto' THEN 'automatica' ELSE 'manual' END,
               'comprovante', l.proof_id,
               'cliente', coalesce(l.cliente, '(sem cliente)'),
               'parcela', coalesce(l.description, 'parcela'),
               'vencimento', to_char(l.due_date, 'DD/MM/YYYY'),
               'valor', l.amount_paid,
               'situacao_atual', CASE WHEN l.ar_status = 'pago' THEN 'quitada'
                                      ELSE 'em aberto: R$ ' || replace(to_char(l.ar_amount, 'FM9999999990.00'), '.', ',') END,
               'pagador', l.ai_payer_name,
               'data_pagamento', to_char(l.payment_date AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'))
             ORDER BY l.created_at)
        FROM l), '[]'::jsonb),
    'aguardando', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'hora', to_char(pend.created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
               'cliente', coalesce(pend.cliente, '(não identificada)'),
               'pagador', pend.ai_payer_name,
               'valor', pend.ai_amount,
               'motivo', pend.settlement_note)
             ORDER BY pend.created_at)
        FROM pend), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.relatorio_baixas_dia(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relatorio_baixas_dia(date) TO service_role;

-- Segredo que o agendamento envia para a função (gerado aqui, ninguém digita).
SELECT vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'report_secret', 'Agendamento do relatório diário de baixas')
 WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'report_secret');

-- A função lê os segredos pelo cofre: o do agendamento e, se cadastrada no cofre,
-- a senha do e-mail (o normal é cadastrá-la como SMTP_PASSWORD nas variáveis da função).
CREATE OR REPLACE FUNCTION public.get_internal_secret(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
BEGIN
  IF p_name NOT IN ('bubblewhats_webhook_secret', 'dunning_secret', 'report_secret', 'smtp_password') THEN
    RAISE EXCEPTION 'segredo não permitido';
  END IF;
  RETURN (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1);
END;
$function$;

-- Todo dia às 07:00 (10:00 UTC): relatório do dia anterior.
SELECT cron.unschedule('jmk-relatorio-baixas')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jmk-relatorio-baixas');
SELECT cron.schedule('jmk-relatorio-baixas', '0 10 * * *', $cron$
  SELECT net.http_post(
    url := 'https://ouwlrhculdfmlgguwezw.supabase.co/functions/v1/relatorio-baixas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-report-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'report_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
$cron$);
