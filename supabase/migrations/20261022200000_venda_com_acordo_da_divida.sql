-- Venda que já fecha o acordo com a dívida antiga.
--
-- No PDV, quando a cliente tem parcelas em aberto e a compra vai para a
-- carteira, o operador pode somar a dívida à compra e refazer o parcelamento.
-- As duas coisas precisam acontecer na mesma transação: se a venda entrasse
-- com o valor somado e o encerramento das parcelas antigas falhasse, a cliente
-- ficaria devendo duas vezes.
--
-- As parcelas antigas não são apagadas (há pagamentos parciais vinculados a
-- elas e a trava de exclusão recusaria) nem viram receita: ficam como 'pago',
-- com a data e o motivo na descrição. O painel e o relatório diário somam
-- receivable_payments, não paid_at, então nada é contado como recebido.
CREATE OR REPLACE FUNCTION public.create_sale_renegociando(
  p_customer_id    uuid,
  p_total          numeric,
  p_payment_method text,
  p_installments   int,
  p_notes          text,
  p_items          jsonb,
  p_receivables    jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sale    uuid;
  v_antigas uuid[];
  v_total   numeric;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Acordo exige cliente identificado';
  END IF;

  -- Fotografa a dívida ANTES da venda, senão as parcelas novas entrariam na lista.
  SELECT array_agg(ar.id), round(coalesce(sum(ar.amount), 0), 2)
    INTO v_antigas, v_total
    FROM public.accounts_receivable ar
   WHERE ar.customer_id = p_customer_id
     AND ar.status IN ('pendente', 'vencido');

  IF v_antigas IS NULL THEN
    RAISE EXCEPTION 'A cliente não tem parcelas em aberto para renegociar';
  END IF;

  v_sale := public.create_sale(
    p_customer_id, p_total, p_payment_method, p_installments, p_notes, p_items, p_receivables
  );

  UPDATE public.accounts_receivable
     SET status      = 'pago',
         paid_at     = now(),
         description = coalesce(description, '')
                       || ' — renegociada em '
                       || to_char(timezone('America/Sao_Paulo', now()), 'DD/MM/YYYY')
                       || ': saldo somado ao novo acordo'
   WHERE id = ANY(v_antigas);

  RETURN v_sale;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_renegociando(uuid, numeric, text, int, text, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_renegociando(uuid, numeric, text, int, text, jsonb, jsonb) TO authenticated;
