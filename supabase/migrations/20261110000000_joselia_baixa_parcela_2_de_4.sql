-- JOSELIA VADIVINO DA SILVA OLIVEIRA: baixa da parcela 2/4.
--
-- Ela mandou o comprovante no WhatsApp hoje, 09/11/2026, às 15:44 — bem no
-- meio da queda do BubbleWhats (das 13:46 às 17:18), então a mensagem não
-- entrou no sistema e não existe payment_proof para amarrar. Conferido na
-- tela do WhatsApp Web:
--     Pix Bradesco de R$ 144,00, 09/11/2026 15:44:24
--     quem pagou:   JOSELIA VADIVINO DA SILVA OLIVEIRA
--     quem recebeu: JASPRINT, CNPJ 55.793.541/0001-06, Itaú (a chave da JMK)
--     número de controle: E60746948202611091843A22894Xymsg
--
-- O valor é exatamente o da parcela 2/4, que vence em 28/11/2026. Ela paga
-- adiantado: a 1/4, de 28/10, foi paga em 19/10 do mesmo jeito, por Pix do
-- Bradesco. Nada na conversa pede outra coisa — depois do comprovante só
-- vieram áudios de recado e uma figurinha.
--
-- Como a baixa precisa de comprovante ligado (receivable_payments.proof_id é
-- NOT NULL), o registro entra no formato das baixas manuais da tela:
-- storage_path vazio, source 'manual', e os dados do Pix na descrição.
--
-- Fica em aberto: R$ 288,00 — 3/4 em 28/12/2026 e 4/4 em 28/01/2027.
DO $joselia$
DECLARE
  v_cli    uuid;
  v_antes  numeric;
  v_qtd    int;
  v_par    uuid;
  v_prova  uuid;
  v_depois numeric;
  v_pago   numeric;
BEGIN
  SELECT id INTO v_cli FROM public.customers
   WHERE name = 'JOSELIA VADIVINO DA SILVA OLIVEIRA';
  IF v_cli IS NULL THEN
    RAISE EXCEPTION 'Não achei a cliente JOSELIA VADIVINO DA SILVA OLIVEIRA.';
  END IF;

  SELECT coalesce(sum(amount), 0), count(*) INTO v_antes, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_antes <> 432.00 OR v_qtd <> 3 THEN
    RAISE EXCEPTION 'A conta mudou desde a conferência: % parcelas somando R$ % (esperado 3 e R$ 432,00).', v_qtd, v_antes;
  END IF;

  SELECT id INTO v_par
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido')
     AND due_date = DATE '2026-11-28' AND amount = 144.00;

  IF v_par IS NULL THEN
    RAISE EXCEPTION 'Não achei a parcela de R$ 144,00 de 28/11/2026.';
  END IF;

  INSERT INTO public.payment_proofs
         (customer_id, storage_path, source, settlement_status, payment_date, description)
  VALUES (v_cli, '', 'manual', 'manual', TIMESTAMPTZ '2026-11-09 15:44:24-03',
          'Recebimento manual — JOSELIA VADIVINO DA SILVA OLIVEIRA — Pix Bradesco de R$ 144,00 em 09/11/2026 15:44:24, controle E60746948202611091843A22894Xymsg, recebedor JASPRINT (chave da JMK). Comprovante conferido no WhatsApp Web; chegou durante a queda do BubbleWhats, por isso não há arquivo guardado.')
  RETURNING id INTO v_prova;

  INSERT INTO public.receivable_payments (receivable_id, proof_id, amount_paid, created_at)
  VALUES (v_par, v_prova, 144.00, TIMESTAMPTZ '2026-11-09 15:44:24-03');

  UPDATE public.accounts_receivable
     SET status = 'pago',
         paid_at = TIMESTAMPTZ '2026-11-09 15:44:24-03'
   WHERE id = v_par;

  -- conferência
  SELECT coalesce(sum(amount), 0), count(*) INTO v_depois, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_depois <> 288.00 OR v_qtd <> 2 THEN
    RAISE EXCEPTION 'Depois da baixa sobraram % parcelas somando R$ % (esperado 2 e R$ 288,00).', v_qtd, v_depois;
  END IF;

  SELECT coalesce(sum(amount_paid), 0) INTO v_pago
    FROM public.receivable_payments WHERE receivable_id = v_par;

  IF v_pago <> 144.00 THEN
    RAISE EXCEPTION 'A parcela de 28/11 ficou com R$ % lançados (esperado R$ 144,00).', v_pago;
  END IF;
END
$joselia$;
