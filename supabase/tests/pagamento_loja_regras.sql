-- Teste das regras de dinheiro do pagamento online da loja.
--
-- Roda no editor SQL e DESFAZ TUDO no fim (o RAISE EXCEPTION final derruba a
-- transação inteira). Nenhum pedido, cliente, venda ou mensagem sobra.
--
-- session_replication_role = replica desliga os gatilhos durante o teste: sem
-- isso o pedido de mentira dispararia o aviso de WhatsApp de verdade.
--
-- O que está sendo provado:
--   1. abrir a cobrança duas vezes não cria duas cobranças;
--   2. pagamento confirmado dá baixa e transforma o pedido em venda;
--   3. o mesmo aviso chegando de novo não dá baixa dobrada;
--   4. valor pago maior que o cobrado (juros do parcelamento) é aceito;
--   5. pagamento recusado não mexe no financeiro;
--   6. estorno marca a cobrança, sem apagar o histórico.
DO $teste$
DECLARE
  v_order  uuid;
  v_c1     payment_charges;
  v_c2     payment_charges;
  v_res    jsonb;
  v_status text;
  v_trans  int;
  v_sale   uuid;
  v_falhas text := '';
BEGIN
  SET LOCAL session_replication_role = replica;

  INSERT INTO store_orders (code, status, customer_name, customer_phone, delivery_method, total)
  VALUES ('TST999', 'novo', 'CLIENTE DE TESTE', '5511999999999', 'retirada', 150.00)
  RETURNING id INTO v_order;

  INSERT INTO store_order_items (order_id, product_name, size, color, quantity, unit_price, unit_cost)
  VALUES (v_order, 'PECA DE TESTE', 'M', 'PRETO', 1, 150.00, 50.00);

  -- 1) idempotência ao abrir
  v_c1 := public.store_charge_open(v_order);
  v_c2 := public.store_charge_open(v_order);
  IF v_c1.id <> v_c2.id THEN
    v_falhas := v_falhas || '[1] abriu duas cobranças para o mesmo pedido; ';
  END IF;
  IF v_c1.amount_cents <> 15000 THEN
    v_falhas := v_falhas || format('[1] valor errado: %s (esperado 15000); ', v_c1.amount_cents);
  END IF;
  IF v_c1.order_nsu <> 'JMK-TST999' THEN
    v_falhas := v_falhas || format('[1] order_nsu errado: %s; ', v_c1.order_nsu);
  END IF;

  -- 2) pagamento confirmado
  v_res := public.store_charge_settle(v_c1.id, 'TRX-1', 'paid', 15000, 'pix', 1, '{"teste":true}'::jsonb);
  SELECT status INTO v_status FROM payment_charges WHERE id = v_c1.id;
  IF v_status <> 'pago' THEN
    v_falhas := v_falhas || format('[2] cobrança ficou %s em vez de pago; ', v_status);
  END IF;
  SELECT status, sale_id INTO v_status, v_sale FROM store_orders WHERE id = v_order;
  IF v_status <> 'confirmado' OR v_sale IS NULL THEN
    v_falhas := v_falhas || format('[2] pedido ficou %s e venda %s; ', v_status, coalesce(v_sale::text, 'nenhuma'));
  END IF;

  -- 3) mesmo aviso de novo (reentrega do webhook)
  v_res := public.store_charge_settle(v_c1.id, 'TRX-1', 'paid', 15000, 'pix', 1, '{"teste":true}'::jsonb);
  SELECT count(*) INTO v_trans FROM payment_transactions WHERE charge_id = v_c1.id AND transaction_nsu = 'TRX-1';
  IF v_trans <> 1 THEN
    v_falhas := v_falhas || format('[3] gravou %s transações para a mesma TRX-1; ', v_trans);
  END IF;
  IF v_res->>'situacao' <> 'ja_estava_pago' THEN
    v_falhas := v_falhas || format('[3] segunda chamada devolveu %s; ', v_res->>'situacao');
  END IF;
  SELECT count(*) INTO v_trans FROM sales WHERE id = v_sale;
  IF v_trans <> 1 THEN
    v_falhas := v_falhas || '[3] a venda foi criada mais de uma vez; ';
  END IF;

  -- 4) valor pago maior que o cobrado (parcelamento com juros)
  v_res := public.store_charge_settle(v_c1.id, 'TRX-2', 'settled', 16350, 'credit_card', 3, NULL);
  SELECT paid_amount_cents INTO v_trans FROM payment_transactions WHERE transaction_nsu = 'TRX-2';
  IF v_trans <> 16350 THEN
    v_falhas := v_falhas || format('[4] guardou %s como valor pago; ', coalesce(v_trans::text, 'nada'));
  END IF;

  -- 5) recusado não dá baixa
  DECLARE
    v_order2 uuid;
    v_c3     payment_charges;
  BEGIN
    INSERT INTO store_orders (code, status, customer_name, customer_phone, delivery_method, total)
    VALUES ('TST998', 'novo', 'CLIENTE DE TESTE 2', '5511999999998', 'retirada', 90.00)
    RETURNING id INTO v_order2;

    v_c3 := public.store_charge_open(v_order2);
    v_res := public.store_charge_settle(v_c3.id, 'TRX-3', 'payment_failed', 9000, 'credit_card', 1, NULL);

    SELECT status INTO v_status FROM payment_charges WHERE id = v_c3.id;
    IF v_status = 'pago' THEN
      v_falhas := v_falhas || '[5] pagamento recusado deu baixa; ';
    END IF;
    SELECT status INTO v_status FROM store_orders WHERE id = v_order2;
    IF v_status <> 'novo' THEN
      v_falhas := v_falhas || format('[5] pedido virou %s com pagamento recusado; ', v_status);
    END IF;

    -- 6) estorno
    v_res := public.store_charge_settle(v_c3.id, 'TRX-4', 'refunded', 9000, 'credit_card', 1, NULL);
    SELECT status INTO v_status FROM payment_charges WHERE id = v_c3.id;
    IF v_status <> 'estornado' THEN
      v_falhas := v_falhas || format('[6] estorno deixou a cobrança como %s; ', v_status);
    END IF;
    SELECT count(*) INTO v_trans FROM payment_transactions WHERE charge_id = v_c3.id;
    IF v_trans < 2 THEN
      v_falhas := v_falhas || '[6] o estorno apagou o histórico da tentativa anterior; ';
    END IF;
  END;

  IF v_falhas = '' THEN
    RAISE EXCEPTION 'TESTE (desfeito) >> PASSOU: as 6 regras de dinheiro estão de pé.';
  ELSE
    RAISE EXCEPTION 'TESTE (desfeito) >> FALHOU: %', v_falhas;
  END IF;
END
$teste$;
