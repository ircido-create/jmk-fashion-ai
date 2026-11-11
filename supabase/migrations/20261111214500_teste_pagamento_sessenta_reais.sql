-- Segundo pedido de teste do pagamento online: R$ 60,00.
--
-- POR QUÊ UM SEGUNDO. No teste de R$ 1,00 o checkout só oferece "1x sem juros
-- de R$ 1,00": a InfinitePay exige pelo menos R$ 1,00 por parcela, então uma
-- compra de R$ 1,00 não tem como ser dividida. Com R$ 60,00 a lista inteira
-- aparece, e dá para ver na tela o que a cliente vê: a 1x sem juros (a loja
-- assume, por causa de assured_installments = 1) e as demais com o juro do
-- cartão por conta dela.
--
-- Este pedido é só para OLHAR a tela. Não precisa ser pago.
--
-- As mesmas proteções do teste anterior valem aqui: aviso de WhatsApp
-- desligado na inserção, link pedido sem enviar mensagem, item sem produto
-- (nada sai do estoque) e telefone o da própria loja.
DO $teste60$
DECLARE
  v_fone text;
  v_id   uuid;
  v_req  bigint;
  v_code text := 'TESTE60-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DDMMHH24MI');
BEGIN
  SELECT coalesce(nullif(order_alert_whatsapp, ''), whatsapp)
    INTO v_fone
    FROM public.store_settings
   LIMIT 1;

  IF coalesce(v_fone, '') = '' THEN
    RAISE EXCEPTION 'Sem telefone da loja em store_settings — não crio pedido com telefone de terceiro.';
  END IF;

  EXECUTE 'ALTER TABLE public.store_orders DISABLE TRIGGER trg_store_order_notify';

  INSERT INTO public.store_orders
         (code, status, customer_name, customer_phone, delivery_method, total, notes)
  VALUES (v_code, 'novo', 'TESTE PAGAMENTO ONLINE', v_fone, 'retirada', 60.00,
          'Pedido de teste do pagamento online (R$ 60,00) em 11/11/2026, só para ver a lista de parcelas. Não é venda: nenhuma peça saiu do estoque e nenhuma mensagem foi enviada.')
  RETURNING id INTO v_id;

  INSERT INTO public.store_order_items
         (order_id, product_name, quantity, unit_price)
  VALUES (v_id, 'Teste de pagamento — não é peça', 1, 60.00);

  EXECUTE 'ALTER TABLE public.store_orders ENABLE TRIGGER trg_store_order_notify';

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

  RAISE NOTICE 'Pedido de teste % criado; link pedido na requisição %.', v_code, v_req;
END
$teste60$;
