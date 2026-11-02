-- MARIA APARECIDA LEANDRA DE JESUS SANTOS ("Cida Arlete") devolveu uma peça.
--
-- Ela devolveu o VESTIDO MOUSSE ROMA (R$ 280,00) da compra de 31/08/2026, e a
-- loja refez o combinado: o que sobra vira 4 parcelas de R$ 220,00, a primeira
-- vencendo em 20/11/2026.
--
-- A devolução passa por alterar_item_venda, a mesma função da tela de Vendas:
-- ela devolve a peça ao estoque, baixa o total da venda (R$ 1.600 → R$ 1.320) e
-- redivide o saldo em aberto. Depois disso as parcelas ficam como a loja
-- acertou com ela.
--
-- A parcela que vencia em 20/10 sai do acordo: ela já tinha recebido R$ 173,00
-- em 27/10, e esse pagamento continua registrado — o que some é só o saldo de
-- R$ 94,00, que entrou na conta nova. Por isso ela vira 'cancelado' e não some
-- do histórico.
--
-- Conferência no fim: 4 parcelas somando R$ 880,00. Se não fechar, nada é
-- gravado.
DO $devolucao$
DECLARE
  v_cliente  uuid := 'f20db90f-7948-488d-83ea-9b86fe2658ca';
  v_venda    uuid := 'c3943fab-640d-4a56-91db-e65a4bcbc362';
  v_item     uuid := 'eb0ae8d3-44a7-4675-9ba8-00f8ac9e73a0';
  v_admin    uuid;
  v_antes    numeric;
  v_depois   numeric;
  v_qtd      int;
  v_total    numeric;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO v_antes
    FROM accounts_receivable
   WHERE customer_id = v_cliente AND status IN ('pendente', 'vencido');

  IF v_antes <> 1160.00 THEN
    RAISE EXCEPTION 'Saldo em aberto mudou desde a conferência: R$ % (esperado R$ 1.160,00).', v_antes;
  END IF;

  -- alterar_item_venda exige um admin logado; aqui quem roda é a migração.
  SELECT user_id INTO v_admin FROM user_roles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- 1) a devolução: peça volta ao estoque, venda cai para R$ 1.320,00
  PERFORM public.alterar_item_venda(v_item, 0);

  SELECT total INTO v_total FROM sales WHERE id = v_venda;
  IF v_total <> 1320.00 THEN
    RAISE EXCEPTION 'A venda ficou R$ % (esperado R$ 1.320,00).', v_total;
  END IF;

  -- 2) a parcela de 20/10 sai do acordo (o pagamento dela fica no histórico)
  UPDATE accounts_receivable
     SET status = 'cancelado',
         description = 'Carteira (2/6) · saldo levado para o acordo de 02/11/2026 (devolução do Vestido Mousse Roma)',
         updated_at = now()
   WHERE customer_id = v_cliente
     AND due_date = DATE '2026-10-20'
     AND status IN ('pendente', 'vencido');

  -- 3) o que sobra: 4 parcelas iguais, a primeira em 20/11
  UPDATE accounts_receivable
     SET amount = 220.00,
         description = 'Acordo 02/11/2026 ('
                       || (CASE due_date
                             WHEN DATE '2026-11-20' THEN '1'
                             WHEN DATE '2026-12-20' THEN '2'
                             WHEN DATE '2027-01-20' THEN '3'
                             ELSE '4' END)
                       || '/4)',
         updated_at = now()
   WHERE customer_id = v_cliente
     AND due_date IN (DATE '2026-11-20', DATE '2026-12-20', DATE '2027-01-20', DATE '2027-02-20')
     AND status IN ('pendente', 'vencido');

  -- 4) conferência
  SELECT count(*), coalesce(sum(amount), 0) INTO v_qtd, v_depois
    FROM accounts_receivable
   WHERE customer_id = v_cliente AND status IN ('pendente', 'vencido');

  IF v_qtd <> 4 THEN
    RAISE EXCEPTION 'Deveriam sobrar 4 parcelas, sobraram %.', v_qtd;
  END IF;
  IF v_depois <> 880.00 THEN
    RAISE EXCEPTION 'A conta não fecha: R$ % em aberto (esperado R$ 880,00).', v_depois;
  END IF;
END
$devolucao$;
