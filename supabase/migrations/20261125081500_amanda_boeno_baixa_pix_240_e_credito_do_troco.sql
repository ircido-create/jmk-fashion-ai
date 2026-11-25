-- AMANDA SILVA BOENO: baixa do Pix de R$ 240,00 e crédito do troco.
--
-- Ela mandou o comprovante no WhatsApp em 24/11/2026 às 16:50 (payment_proof
-- db3d960f-24ed-4794-a838-67fd8f738a12), e a baixa automática não encostou
-- nele porque o valor é MAIOR que o saldo: a nota gravada foi
-- "Valor maior que o saldo em aberto (R$ 225,36) — confira antes de dar baixa".
--
--     Pix CAIXA -> ITAÚ UNIBANCO, R$ 240,00, 24/11/2026
--     quem pagou: Amanda da Silva Boeno
--     controle:   E0036030520261124194928...
--
-- Ela só tem uma parcela em aberto: a 5/5 da Carteira, R$ 225,36, vencendo
-- em 25/11/2026. As 1/5 a 4/5 já estavam quitadas (as de setembro e outubro
-- pelos Pix de R$ 225,36 que ela mandou nos mesmos dias).
--
-- Confirmado na conversa, logo depois do comprovante (24/11 16:50):
--     "Agora acabou"
--     "Mês q vem começo a de 80"
-- Ou seja, ela encerrou esta carteira e vai começar outra, de R$ 80, em
-- dezembro. Essa carteira nova AINDA NÃO EXISTE no sistema — não há parcela
-- seguinte para receber o troco.
--
-- Por isso a baixa fica assim:
--   * a 5/5 é quitada com R$ 225,36 (o saldo exato da parcela);
--   * o que sobrou do Pix, R$ 14,64, não vira parcela nova nem cobrança — fica
--     registrado como crédito a favor dela, para abater na primeira parcela da
--     carteira de R$ 80. Fica na nota da cliente e na nota do comprovante, que
--     são os dois lugares que a tela mostra.
--
-- O modelo não aceita lançar R$ 240,00 na parcela de R$ 225,36:
-- apply_receivable_payment recusa quitação com valor diferente do saldo, e
-- lançar a mais deixaria o troco invisível, preso numa parcela já paga.
--
-- Depois desta migração a Amanda fica sem nada em aberto.
DO $amanda$
DECLARE
  v_cli    uuid;
  v_prova  uuid;
  v_par    uuid;
  v_qtd    int;
  v_aberto numeric;
  v_pago   numeric;
BEGIN
  SELECT id INTO v_cli FROM public.customers
   WHERE name = 'AMANDA SILVA BOENO';
  IF v_cli IS NULL THEN
    RAISE EXCEPTION 'Não achei a cliente AMANDA SILVA BOENO.';
  END IF;

  v_prova := 'db3d960f-24ed-4794-a838-67fd8f738a12'::uuid;

  -- O comprovante tem de ser dela, de R$ 240,00 e ainda não baixado.
  PERFORM 1 FROM public.payment_proofs
   WHERE id = v_prova
     AND customer_id = v_cli
     AND ai_amount = 240.00
     AND coalesce(settlement_status, 'pendente') = 'pendente'
     AND NOT EXISTS (SELECT 1 FROM public.receivable_payments rp WHERE rp.proof_id = v_prova);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O comprovante de R$ 240,00 da Amanda mudou desde a conferência (dono, valor ou já baixado).';
  END IF;

  -- A conta dela tem de estar como conferido: uma só parcela aberta, R$ 225,36.
  SELECT count(*), coalesce(sum(amount), 0) INTO v_qtd, v_aberto
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_qtd <> 1 OR v_aberto <> 225.36 THEN
    RAISE EXCEPTION 'A conta mudou desde a conferência: % parcela(s) somando R$ % (esperado 1 e R$ 225,36).', v_qtd, v_aberto;
  END IF;

  SELECT id INTO v_par
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido')
     AND due_date = DATE '2026-11-25' AND amount = 225.36;

  IF v_par IS NULL THEN
    RAISE EXCEPTION 'Não achei a parcela 5/5 de R$ 225,36 de 25/11/2026.';
  END IF;

  -- Quitação da 5/5 com o saldo exato.
  INSERT INTO public.receivable_payments (receivable_id, proof_id, amount_paid, created_at)
  VALUES (v_par, v_prova, 225.36, TIMESTAMPTZ '2026-11-24 16:50:00-03');

  UPDATE public.accounts_receivable
     SET status = 'pago',
         paid_at = TIMESTAMPTZ '2026-11-24 16:50:00-03'
   WHERE id = v_par;

  -- Comprovante sai da fila de pendentes, com o troco escrito na nota.
  UPDATE public.payment_proofs
     SET settlement_status = 'manual',
         settled_at = now(),
         settlement_note = 'Baixa manual 25/11/2026: Pix de R$ 240,00 quitou a Carteira (5/5) de R$ 225,36 (venc. 25/11/2026). '
                        || 'Sobraram R$ 14,64 a favor da cliente — guardados como crédito para abater na primeira parcela da carteira nova de R$ 80, '
                        || 'conforme ela avisou no WhatsApp em 24/11/2026 ("Agora acabou", "Mês q vem começo a de 80").'
   WHERE id = v_prova;

  -- Crédito também na ficha da cliente, que é onde o vendedor olha na hora da venda.
  UPDATE public.customers
     SET notes = CASE
                   WHEN coalesce(trim(notes), '') = '' THEN ''
                   ELSE notes || E'\n'
                 END
                 || 'CRÉDITO DE R$ 14,64 (25/11/2026): troco do Pix de R$ 240,00 de 24/11/2026, que quitou a última parcela da carteira (R$ 225,36). Abater na primeira parcela da carteira nova de R$ 80.'
   WHERE id = v_cli;

  -- Conferência.
  SELECT count(*), coalesce(sum(amount), 0) INTO v_qtd, v_aberto
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_qtd <> 0 OR v_aberto <> 0 THEN
    RAISE EXCEPTION 'Depois da baixa ainda sobraram % parcela(s) somando R$ % (esperado nenhuma).', v_qtd, v_aberto;
  END IF;

  SELECT coalesce(sum(amount_paid), 0) INTO v_pago
    FROM public.receivable_payments WHERE receivable_id = v_par;

  IF v_pago <> 225.36 THEN
    RAISE EXCEPTION 'A parcela 5/5 ficou com R$ % lançados (esperado R$ 225,36).', v_pago;
  END IF;
END
$amanda$;
