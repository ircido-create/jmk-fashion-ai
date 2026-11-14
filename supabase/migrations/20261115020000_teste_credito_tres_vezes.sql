-- Teste da regra nova: ate 3x sem juros nas compras a partir de R$ 300.
--
-- Dois pedidos, para ver os dois lados da regra na tela do checkout:
--   TESTE350 (R$ 350,00) -> acima do minimo: 1x, 2x e 3x pelo valor cheio
--   TESTE120 (R$ 120,00) -> abaixo do minimo: so a 1x sem acrescimo
--
-- Sao pedidos so para OLHAR. Nao precisam ser pagos.
-- As mesmas protecoes dos testes de 11/11 valem aqui: aviso de WhatsApp
-- desligado na insercao, link pedido sem enviar mensagem, item sem produto
-- (nada sai do estoque) e telefone o da propria loja.
DO $teste3x$
DECLARE
  v_fone text;
  v_id   uuid;
  v_req  bigint;
  v_sufixo text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DDMMHH24MI');
BEGIN
  SELECT coalesce(nullif(order_alert_whatsapp, ''), whatsapp)
    INTO v_fone
    FROM public.store_settings
   LIMIT 1;

  IF coalesce(v_fone, '') = '' THEN
    RAISE EXCEPTION 'Sem telefone da loja em store_settings — nao crio pedido com telefone de terceiro.';
  END IF;

  EXECUTE 'ALTER TABLE public.store_orders DISABLE TRIGGER trg_store_order_notify';

  -- ---------------------------------------------------- acima do minimo
  INSERT INTO public.store_orders
         (code, status, customer_name, customer_phone, delivery_method, total, notes)
  VALUES ('TESTE350-' || v_sufixo, 'novo', 'TESTE 3X SEM JUROS', v_fone, 'retirada', 350.00,
          'Pedido de teste em 14/11/2026: compra acima de R$ 300, para ver 1x, 2x e 3x sem juros. Nao e venda.')
  RETURNING id INTO v_id;

  INSERT INTO public.store_order_items (order_id, product_name, quantity, unit_price)
  VALUES (v_id, 'Teste de pagamento — nao e peca', 1, 350.00);

  SELECT net.http_post(
           url := 'https://ouwlrhculdfmlgguwezw.supabase.co/functions/v1/infinitepay-create-link',
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'x-store-payment-secret',
                        (SELECT decrypted_secret FROM vault.decrypted_secrets
                          WHERE name = 'store_payment_secret' LIMIT 1)),
           body := jsonb_build_object('order_id', v_id, 'enviar_whatsapp', false),
           timeout_milliseconds := 30000)
    INTO v_req;
  RAISE NOTICE 'TESTE350 criado (%), link pedido na requisicao %.', v_id, v_req;

  -- --------------------------------------------------- abaixo do minimo
  INSERT INTO public.store_orders
         (code, status, customer_name, customer_phone, delivery_method, total, notes)
  VALUES ('TESTE120-' || v_sufixo, 'novo', 'TESTE ABAIXO DO MINIMO', v_fone, 'retirada', 120.00,
          'Pedido de teste em 14/11/2026: compra abaixo de R$ 300, para confirmar que so a 1x sai sem juros. Nao e venda.')
  RETURNING id INTO v_id;

  INSERT INTO public.store_order_items (order_id, product_name, quantity, unit_price)
  VALUES (v_id, 'Teste de pagamento — nao e peca', 1, 120.00);

  SELECT net.http_post(
           url := 'https://ouwlrhculdfmlgguwezw.supabase.co/functions/v1/infinitepay-create-link',
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'x-store-payment-secret',
                        (SELECT decrypted_secret FROM vault.decrypted_secrets
                          WHERE name = 'store_payment_secret' LIMIT 1)),
           body := jsonb_build_object('order_id', v_id, 'enviar_whatsapp', false),
           timeout_milliseconds := 30000)
    INTO v_req;
  RAISE NOTICE 'TESTE120 criado (%), link pedido na requisicao %.', v_id, v_req;

  EXECUTE 'ALTER TABLE public.store_orders ENABLE TRIGGER trg_store_order_notify';
END
$teste3x$;
