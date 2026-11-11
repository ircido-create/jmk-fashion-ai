-- MARISA GOMES DA SILVA: saldo reparcelado em R$ 300, dia 15 e dia 30.
--
-- POR QUÊ. A compra de 31/08/2026 (7 peças, R$ 2.540,00) está certinha: ela já
-- pagou R$ 1.200,00 em quatro Pix de R$ 300 (01/09, 28/09, 16/10 e 31/10) e
-- restam R$ 1.340,00. O problema é que ela paga R$ 300 redondos e as parcelas
-- eram de R$ 324 e R$ 348 — sempre sobra resto. Do pagamento de 31/10 sobraram
-- R$ 48,00, e desde 03/11 a cobrança automática manda lembrete TODO DIA por
-- esses R$ 48. Já foram 7 mensagens e ela não respondeu nenhuma — sumiu desde
-- que mandou o comprovante, em 31/10.
--
-- No WhatsApp, em 16/10, ela explicou quando pode pagar: "dia 15 e dia 30".
--
-- O QUE MUDA. O mesmo saldo de R$ 1.340,00 passa a ser cobrado em parcelas de
-- R$ 300, nas datas dela, com o resto no fim:
--     de                               para
--     31/10/2026  R$  48,00 (vencida)  15/11/2026  R$ 300,00
--     15/11/2026  R$ 324,00            30/11/2026  R$ 300,00
--     30/11/2026  R$ 324,00            15/12/2026  R$ 300,00
--     15/12/2026  R$ 324,00            30/12/2026  R$ 300,00
--     31/12/2026  R$ 320,00            15/01/2027  R$ 140,00
--
-- O saldo não muda: R$ 1.340,00 antes e depois. Nada de pagamento é mexido —
-- as baixas continuam ligadas às mesmas parcelas, inclusive os R$ 276,00 que
-- já estão lançados na parcela que hoje vence em 31/10. A parcela paga de
-- R$ 24,00 (1/6) fica como está.
--
-- Efeito prático: nada fica vencido, e a cobrança diária dos R$ 48 para hoje.
DO $marisa$
DECLARE
  v_cli    uuid;
  v_antes  numeric;
  v_qtd    int;
  v_p1     uuid;  -- hoje 31/10, R$ 48,00 (vencida)
  v_p2     uuid;  -- hoje 15/11, R$ 324,00
  v_p3     uuid;  -- hoje 30/11, R$ 324,00
  v_p4     uuid;  -- hoje 15/12, R$ 324,00
  v_p5     uuid;  -- hoje 31/12, R$ 320,00
  v_depois numeric;
  v_fora   int;
BEGIN
  SELECT id INTO v_cli FROM public.customers WHERE name = 'Marisa Gomes Da Silva';
  IF v_cli IS NULL THEN
    RAISE EXCEPTION 'Não achei a cliente Marisa Gomes Da Silva.';
  END IF;

  SELECT coalesce(sum(amount), 0), count(*) INTO v_antes, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_antes <> 1340.00 OR v_qtd <> 5 THEN
    RAISE EXCEPTION 'A conta mudou desde a conferência: % parcelas somando R$ % (esperado 5 e R$ 1.340,00).', v_qtd, v_antes;
  END IF;

  SELECT id INTO v_p1 FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente','vencido')
     AND due_date = DATE '2026-10-31' AND amount = 48.00;
  SELECT id INTO v_p2 FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente','vencido')
     AND due_date = DATE '2026-11-15' AND amount = 324.00;
  SELECT id INTO v_p3 FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente','vencido')
     AND due_date = DATE '2026-11-30' AND amount = 324.00;
  SELECT id INTO v_p4 FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente','vencido')
     AND due_date = DATE '2026-12-15' AND amount = 324.00;
  SELECT id INTO v_p5 FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente','vencido')
     AND due_date = DATE '2026-12-31' AND amount = 320.00;

  IF v_p1 IS NULL OR v_p2 IS NULL OR v_p3 IS NULL OR v_p4 IS NULL OR v_p5 IS NULL THEN
    RAISE EXCEPTION 'Não achei as cinco parcelas em aberto como estavam na conferência.';
  END IF;

  -- da última para a primeira, para não esbarrar em data repetida no caminho
  UPDATE public.accounts_receivable
     SET due_date = DATE '2027-01-15', amount = 140.00, status = 'pendente'
   WHERE id = v_p5;

  UPDATE public.accounts_receivable
     SET due_date = DATE '2026-12-30', amount = 300.00, status = 'pendente'
   WHERE id = v_p4;

  UPDATE public.accounts_receivable
     SET due_date = DATE '2026-12-15', amount = 300.00, status = 'pendente'
   WHERE id = v_p3;

  UPDATE public.accounts_receivable
     SET due_date = DATE '2026-11-30', amount = 300.00, status = 'pendente'
   WHERE id = v_p2;

  UPDATE public.accounts_receivable
     SET due_date = DATE '2026-11-15', amount = 300.00, status = 'pendente'
   WHERE id = v_p1;

  -- conferência
  SELECT coalesce(sum(amount), 0), count(*) INTO v_depois, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_depois <> 1340.00 OR v_qtd <> 5 THEN
    RAISE EXCEPTION 'A conta não fecha: % parcelas somando R$ % (esperado 5 e R$ 1.340,00).', v_qtd, v_depois;
  END IF;

  SELECT count(*) INTO v_fora
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido')
     AND (amount NOT IN (300.00, 140.00)
       OR extract(day FROM due_date) NOT IN (15, 30));

  IF v_fora > 0 THEN
    RAISE EXCEPTION 'Sobraram % parcelas fora do combinado (R$ 300/R$ 140, dia 15 ou 30).', v_fora;
  END IF;

  IF EXISTS (SELECT 1 FROM public.accounts_receivable
              WHERE customer_id = v_cli AND status = 'vencido') THEN
    RAISE EXCEPTION 'Ainda sobrou parcela vencida — a cobrança diária não vai parar.';
  END IF;
END
$marisa$;
