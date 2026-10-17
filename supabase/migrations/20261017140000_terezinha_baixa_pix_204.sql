-- TEREZINHA APARECIDA DOS REIS CORBANEZI: baixa do Pix de R$ 204,00 de 15/10.
--
-- A cliente pagou às 09:59:55 de 15/10/2026 (Pix do Nubank para a chave da
-- JASPRINT, id E18236120202610151259s10fd4adcfa) e avisou por áudio um minuto
-- depois — "tá o Pix aí, é a última" —, mas não mandou a imagem do
-- comprovante. Nada entrou na fila de comprovantes e a parcela seguiu vencida,
-- com a cobrança automática saindo nos dias 15, 16 e 17 com o valor cheio.
--
-- O comprovante foi conferido pela loja (tela do Nubank). Como não há arquivo
-- para guardar em payment_proofs, a baixa é feita na própria parcela e o id da
-- transação fica na descrição, para quem olhar depois saber de onde veio.
--
-- As duas parcelas de R$ 24,00 do mesmo vencimento ficam como estão, por
-- decisão da loja, mesmo parecendo repetidas na importação do pedido 6845.
DO $$
DECLARE
  v_cliente uuid;
  v_parcela uuid;
  v_aberto  numeric;
BEGIN
  SELECT id INTO v_cliente FROM public.customers
   WHERE name = 'TEREZINHA APARECIDA DOS REIS CORBANEZI';
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'Cliente não encontrada.';
  END IF;

  SELECT ar.id INTO v_parcela
    FROM public.accounts_receivable ar
   WHERE ar.customer_id = v_cliente
     AND ar.due_date = DATE '2026-10-15'
     AND ar.amount = 204.00
     AND ar.status = 'vencido';
  IF v_parcela IS NULL THEN
    RAISE EXCEPTION 'Parcela de R$ 204,00 vencida em 15/10/2026 não encontrada (já baixada?).';
  END IF;

  IF EXISTS (SELECT 1 FROM public.receivable_payments WHERE receivable_id = v_parcela) THEN
    RAISE EXCEPTION 'A parcela já tem pagamento registrado — confira antes de lançar de novo.';
  END IF;

  UPDATE public.accounts_receivable
     SET status      = 'pago',
         paid_at     = TIMESTAMPTZ '2026-10-15 09:59:55-03',
         description = description || ' — Pix de 15/10/2026 09:59:55, id E18236120202610151259s10fd4adcfa (comprovante conferido pela loja, sem arquivo no sistema)'
   WHERE id = v_parcela;

  SELECT coalesce(sum(ar.amount), 0) INTO v_aberto
    FROM public.accounts_receivable ar
   WHERE ar.customer_id = v_cliente AND ar.status IN ('pendente', 'vencido');
  IF v_aberto <> 48.00 THEN
    RAISE EXCEPTION 'Depois da baixa ficou R$ % em aberto (esperado R$ 48,00).', v_aberto;
  END IF;
END $$;
