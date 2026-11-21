-- Cópia idempotente de drizzle/migrations/0001_acordo_somente_fiado_misto.sql.
-- CREATE OR REPLACE: rodar de novo deixa a função idêntica, mantém as permissões e não toca em dados.
CREATE OR REPLACE FUNCTION public.create_sale_renegociando(p_customer_id uuid, p_total numeric, p_payment_method text, p_installments integer, p_notes text, p_items jsonb, p_receivables jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale    uuid;
  v_antigas uuid[];
  v_total   numeric;
  v_novas   numeric;
BEGIN
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('fiado', 'misto') THEN
    RAISE EXCEPTION 'Acordo com dívida anterior só é permitido na Carteira (fiado) ou pagamento misto.';
  END IF;

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

  -- O que a venda vai criar de parcela. Sem isso, o acordo não tem para onde
  -- levar a dívida.
  SELECT round(coalesce(sum((r->>'amount')::numeric), 0), 2)
    INTO v_novas
    FROM jsonb_array_elements(coalesce(p_receivables, '[]'::jsonb)) AS r;

  IF v_novas <= 0 THEN
    RAISE EXCEPTION 'Esta venda não gera parcelas, então o acordo encerraria a dívida de R$ % sem nada em troca. Use a carteira (ou crédito com contas a receber) para fechar o acordo.', to_char(v_total, 'FM999G999D00');
  END IF;

  IF v_novas < v_total - 0.01 THEN
    RAISE EXCEPTION 'As parcelas novas somam R$ % e a dívida encerrada é R$ %. O acordo não pode valer menos do que a cliente já devia.',
      to_char(v_novas, 'FM999G999D00'), to_char(v_total, 'FM999G999D00');
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
$function$;
