-- Produção igual ao GitHub (23/09/2026).
--
-- 1) reverse_payment_proof existia só no banco (criada fora do repositório).
--    Copiada aqui exatamente como está em produção, para não se perder se o
--    banco precisar ser recriado. Comparação feita função a função: era a
--    única diferença entre o banco e supabase/migrations.
--
-- 2) Rodadas de cobrança presas em 'executando'. De 16 a 21/09 a função
--    dunning-cron foi cortada por tempo antes de fechar o registro, mas as
--    cobranças saíram (34 a 45 por dia em dunning_logs). O painel continuava
--    mostrando "interrompida" sem dizer quantas foram enviadas.
--    close_stale_dunning_runs fecha como 'falha' — o painel segue acusando o
--    problema — com o motivo e o número real de envios. Roda de hora em hora.

CREATE OR REPLACE FUNCTION public.reverse_payment_proof(p_proof_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment record;
  v_restored_count integer := 0;
  v_restored_total numeric := 0;
  v_today date := timezone('America/Sao_Paulo', now())::date;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Somente administradores podem excluir e estornar pagamentos';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payment_proofs WHERE id = p_proof_id) THEN
    RAISE EXCEPTION 'Comprovante não encontrado';
  END IF;

  FOR v_payment IN
    SELECT rp.receivable_id, rp.amount_paid, ar.status, ar.due_date
      FROM public.receivable_payments rp
      JOIN public.accounts_receivable ar ON ar.id = rp.receivable_id
     WHERE rp.proof_id = p_proof_id
     FOR UPDATE OF ar
  LOOP
    IF v_payment.status = 'pago' THEN
      UPDATE public.accounts_receivable
         SET status = CASE WHEN v_payment.due_date < v_today THEN 'vencido'::public.payment_status ELSE 'pendente'::public.payment_status END,
             paid_at = NULL
       WHERE id = v_payment.receivable_id;
    ELSE
      UPDATE public.accounts_receivable
         SET amount = amount + v_payment.amount_paid,
             status = CASE WHEN v_payment.due_date < v_today THEN 'vencido'::public.payment_status ELSE 'pendente'::public.payment_status END,
             paid_at = NULL
       WHERE id = v_payment.receivable_id;
    END IF;

    v_restored_count := v_restored_count + 1;
    v_restored_total := v_restored_total + v_payment.amount_paid;
  END LOOP;

  DELETE FROM public.payment_proofs WHERE id = p_proof_id;

  RETURN jsonb_build_object(
    'restored_count', v_restored_count,
    'restored_total', v_restored_total
  );
END;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_stale_dunning_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run record;
  v_sent integer;
  v_closed integer := 0;
BEGIN
  FOR v_run IN
    SELECT id, started_at FROM public.dunning_runs
     WHERE status = 'executando' AND started_at < now() - interval '30 minutes'
     FOR UPDATE SKIP LOCKED
  LOOP
    -- Envios registrados entre o início desta rodada e o início da próxima.
    SELECT count(*) INTO v_sent
      FROM public.dunning_logs l
     WHERE l.sent_at >= v_run.started_at
       AND l.sent_at < COALESCE(
             (SELECT min(n.started_at) FROM public.dunning_runs n WHERE n.started_at > v_run.started_at),
             v_run.started_at + interval '1 day');

    UPDATE public.dunning_runs
       SET status = 'falha',
           enviadas = v_sent,
           finished_at = now(),
           erro = 'Rodada interrompida antes de terminar (tempo esgotado). '
                  || v_sent || ' cobrança(s) chegaram a ser enviadas; as demais contas do dia podem ter ficado sem aviso.'
     WHERE id = v_run.id;
    v_closed := v_closed + 1;
  END LOOP;
  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.close_stale_dunning_runs() FROM public, anon, authenticated;

SELECT public.close_stale_dunning_runs();

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'jmk-close-stale-dunning-runs';
SELECT cron.schedule('jmk-close-stale-dunning-runs', '15 * * * *', $$SELECT public.close_stale_dunning_runs();$$);
