CREATE OR REPLACE FUNCTION public.reverse_payment_proof(p_proof_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.reverse_payment_proof(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_payment_proof(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_payment_proof(uuid) TO service_role;