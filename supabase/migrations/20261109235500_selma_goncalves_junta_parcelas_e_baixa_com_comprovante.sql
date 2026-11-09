-- SELMA GONCALVES DOS SANTOS: arredondamento e as duas baixas de novembro.
--
-- Terceira versão. A 20261109230000 foi recusada pela própria conferência (a
-- parcela de R$ 90,00 da peça devolvida já tinha sido excluída pela tela) e a
-- 20261109234500 parou no INSERT das baixas: receivable_payments.proof_id é
-- NOT NULL, ou seja, toda baixa precisa de um comprovante ligado. Nada foi
-- gravado nas duas tentativas — o bloco inteiro volta atrás no erro.
--
-- Esta versão faz como a tela faz. Baixa manual no JMKSYSTEM grava um
-- payment_proofs com storage_path vazio, source 'manual', settlement_status
-- 'manual' e descrição "Recebimento manual — NOME" (563 registros assim no
-- banco). Os dois Pix de hoje e de ontem não têm arquivo guardado porque
-- chegaram durante a queda do BubbleWhats (09/11, das 13:46 às 17:18): as
-- imagens foram conferidas pelo José e os dados do Pix ficam na descrição.
--
-- 1) ARREDONDAMENTO. As 14 parcelas em aberto são restos de pagamentos
--    parciais (R$ 10, R$ 15, R$ 30, R$ 60...) espalhados junto com as
--    parcelas cheias. Por data os valores já batem com o que o José pediu; o
--    que falta é juntar cada data numa parcela só. Em cada data a maior
--    parcela recebe a soma do dia e as outras ficam canceladas com a nota de
--    onde foram parar:
--        05/11/2026  R$ 330,00   (hoje são 7 parcelas)
--        05/12/2026  R$ 300,00   (1)
--        05/01/2027  R$ 300,00   (2)
--        05/02/2027  R$ 300,00   (2)
--        05/03/2027  R$ 290,00   (2)   = R$ 1.520,00
--
-- 2) BAIXAS. Ela pagou a parcela de novembro em duas vezes, por Pix (Mercado
--    Pago → Itaú, recebedor JASPRINT, que é a chave da JMK):
--        R$ 240,00 em 08/11/2026 07:20:44  (transação 187405571687)
--        R$  90,00 em 09/11/2026 17:01:47  (transação 188706071764)
--    Somam exatamente os R$ 330,00 da parcela de 05/11, que fica quitada.
--
-- Fica em aberto: R$ 1.190,00, em quatro parcelas de dezembro a março.
DO $selma$
DECLARE
  v_cli    uuid;
  v_antes  numeric;
  v_qtd    int;
  v_keep   uuid;
  v_datas  date[];
  v_data   date;
  v_total  numeric;
  v_nov    uuid;
  v_prova1 uuid;
  v_prova2 uuid;
  v_depois numeric;
  v_pago   numeric;
BEGIN
  SELECT id INTO v_cli FROM public.customers WHERE name = 'SELMA GONCALVES DOS SANTOS';
  IF v_cli IS NULL THEN
    RAISE EXCEPTION 'Não achei a cliente SELMA GONCALVES DOS SANTOS.';
  END IF;

  SELECT coalesce(sum(amount), 0), count(*) INTO v_antes, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_antes <> 1520.00 OR v_qtd <> 14 THEN
    RAISE EXCEPTION 'A conta mudou desde a conferência: % parcelas somando R$ % (esperado 14 e R$ 1.520,00).', v_qtd, v_antes;
  END IF;

  -- 1) uma parcela por data, com o valor do dia
  SELECT array_agg(DISTINCT due_date ORDER BY due_date) INTO v_datas
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  FOREACH v_data IN ARRAY v_datas LOOP
    SELECT sum(amount) INTO v_total
      FROM public.accounts_receivable
     WHERE customer_id = v_cli AND status IN ('pendente', 'vencido') AND due_date = v_data;

    SELECT id INTO v_keep
      FROM public.accounts_receivable
     WHERE customer_id = v_cli AND status IN ('pendente', 'vencido') AND due_date = v_data
     ORDER BY amount DESC, id
     LIMIT 1;

    UPDATE public.accounts_receivable
       SET status = 'cancelado',
           description = coalesce(description, '') || ' — juntada na parcela de ' || to_char(v_data, 'DD/MM/YYYY')
     WHERE customer_id = v_cli AND status IN ('pendente', 'vencido')
       AND due_date = v_data AND id <> v_keep;

    UPDATE public.accounts_receivable
       SET amount = v_total
     WHERE id = v_keep AND amount <> v_total;
  END LOOP;

  -- 2) a parcela de novembro
  SELECT id INTO v_nov
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido')
     AND due_date = DATE '2026-11-05';

  IF v_nov IS NULL THEN
    RAISE EXCEPTION 'Não achei a parcela de 05/11/2026 depois do arredondamento.';
  END IF;

  SELECT amount INTO v_total FROM public.accounts_receivable WHERE id = v_nov;
  IF v_total <> 330.00 THEN
    RAISE EXCEPTION 'A parcela de 05/11 ficou em R$ % (esperado R$ 330,00).', v_total;
  END IF;

  -- os dois comprovantes, no mesmo formato das baixas manuais da tela
  INSERT INTO public.payment_proofs
         (customer_id, storage_path, source, settlement_status, payment_date, description)
  VALUES (v_cli, '', 'manual', 'manual', TIMESTAMPTZ '2026-11-08 07:20:44-03',
          'Recebimento manual — SELMA GONCALVES DOS SANTOS — Pix Mercado Pago de R$ 240,00 em 08/11/2026 07:20:44, transação 187405571687, recebedor JASPRINT (chave da JMK). Comprovante conferido pelo José; chegou durante a queda do BubbleWhats, por isso não há arquivo guardado.')
  RETURNING id INTO v_prova1;

  INSERT INTO public.payment_proofs
         (customer_id, storage_path, source, settlement_status, payment_date, description)
  VALUES (v_cli, '', 'manual', 'manual', TIMESTAMPTZ '2026-11-09 17:01:47-03',
          'Recebimento manual — SELMA GONCALVES DOS SANTOS — Pix Mercado Pago de R$ 90,00 em 09/11/2026 17:01:47, transação 188706071764, recebedor JASPRINT (chave da JMK). Comprovante conferido pelo José; chegou durante a queda do BubbleWhats, por isso não há arquivo guardado.')
  RETURNING id INTO v_prova2;

  INSERT INTO public.receivable_payments (receivable_id, proof_id, amount_paid, created_at)
  VALUES (v_nov, v_prova1, 240.00, TIMESTAMPTZ '2026-11-08 07:20:44-03'),
         (v_nov, v_prova2,  90.00, TIMESTAMPTZ '2026-11-09 17:01:47-03');

  UPDATE public.accounts_receivable
     SET status = 'pago',
         paid_at = TIMESTAMPTZ '2026-11-09 17:01:47-03'
   WHERE id = v_nov;

  -- conferência final
  SELECT coalesce(sum(amount), 0), count(*) INTO v_depois, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_depois <> 1190.00 OR v_qtd <> 4 THEN
    RAISE EXCEPTION 'Depois de tudo sobraram % parcelas somando R$ % (esperado 4 e R$ 1.190,00).', v_qtd, v_depois;
  END IF;

  SELECT coalesce(sum(amount_paid), 0) INTO v_pago
    FROM public.receivable_payments WHERE receivable_id = v_nov;

  IF v_pago <> 330.00 THEN
    RAISE EXCEPTION 'A parcela de 05/11 ficou com R$ % lançados (esperado R$ 330,00).', v_pago;
  END IF;

  IF EXISTS (SELECT 1 FROM public.accounts_receivable
              WHERE customer_id = v_cli AND status IN ('pendente', 'vencido')
                AND amount NOT IN (300.00, 290.00)) THEN
    RAISE EXCEPTION 'Sobrou parcela em aberto com valor fora de R$ 300,00 / R$ 290,00.';
  END IF;
END
$selma$;
