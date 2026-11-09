-- TATA: todas as parcelas em aberto passam a vencer no dia 30.
--
-- A cliente tem duas compras em andamento, com datas diferentes:
--   * Carteira (x/6), R$ 195,00 por mês, vencendo todo dia 10 — de 11/2026 a 04/2027;
--   * Carteira (x/3), R$ 115, R$ 115 e R$ 120, vencendo todo dia 22 — de 11/2026 a 01/2027.
-- São 9 parcelas, R$ 1.520,00 no total. A pedido, tudo passa para o dia 30.
--
-- Fevereiro de 2027 não tem dia 30 (e 2027 não é bissexto), então a parcela de
-- 10/02/2027 vai para 28/02, o último dia do mês, em vez de pular para março.
--
-- Efeito colateral esperado: em 30/11, 30/12 e 30/01 as duas compras passam a
-- vencer no mesmo dia (R$ 195 + R$ 115/120). Nenhum valor muda — só as datas.
DO $tata$
DECLARE
  v_cliente uuid;
  v_antes   numeric;
  v_depois  numeric;
  v_qtd     int;
  v_fora    int;
BEGIN
  SELECT id INTO v_cliente FROM public.customers WHERE name = 'TATA';
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'Não achei a cliente TATA no cadastro.';
  END IF;

  SELECT coalesce(sum(amount), 0), count(*)
    INTO v_antes, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cliente AND status IN ('pendente', 'vencido');

  IF v_antes <> 1520.00 OR v_qtd <> 9 THEN
    RAISE EXCEPTION 'A conta mudou desde a conferência: % parcelas somando R$ % (esperado 9 e R$ 1.520,00).', v_qtd, v_antes;
  END IF;

  -- dia 30, ou o último dia do mês quando o mês não chega lá
  UPDATE public.accounts_receivable
     SET due_date = LEAST(
           date_trunc('month', due_date)::date + 29,
           (date_trunc('month', due_date) + interval '1 month' - interval '1 day')::date
         )
   WHERE customer_id = v_cliente
     AND status IN ('pendente', 'vencido');

  -- conferência: o saldo não pode mudar e nenhuma parcela pode ter ficado fora do dia 30
  SELECT coalesce(sum(amount), 0), count(*)
    INTO v_depois, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cliente AND status IN ('pendente', 'vencido');

  IF v_depois <> 1520.00 OR v_qtd <> 9 THEN
    RAISE EXCEPTION 'A conta não fecha depois da troca: % parcelas somando R$ %.', v_qtd, v_depois;
  END IF;

  SELECT count(*) INTO v_fora
    FROM public.accounts_receivable
   WHERE customer_id = v_cliente
     AND status IN ('pendente', 'vencido')
     AND extract(day from due_date) <> 30
     AND due_date <> (date_trunc('month', due_date) + interval '1 month' - interval '1 day')::date;

  IF v_fora > 0 THEN
    RAISE EXCEPTION '% parcelas não ficaram no dia 30 nem no último dia do mês.', v_fora;
  END IF;
END
$tata$;
