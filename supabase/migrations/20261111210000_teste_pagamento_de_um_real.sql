-- Pedido de teste do pagamento online: R$ 1,00.
--
-- POR QUÊ. Em 29/10 o único pagamento real da loja saiu errado para a cliente:
-- compra de R$ 10,00, cobrança de R$ 10,44 num crédito em 1x. A InfinitePay
-- repassa a taxa já na primeira parcela quando o link não diz o contrário.
-- Hoje, 11/11/2026, a função infinitepay-create-link passou a mandar
-- options.assured_installments = 1 (commit 280c9d6, publicada pelo Lovable):
-- a loja assume a taxa do crédito à vista. Este pedido existe para provar que
-- a mudança pegou, antes que uma cliente de verdade pague de novo.
--
-- COMO É SEGURO.
--   * O aviso de pedido fica desligado durante a inserção, então NENHUMA
--     mensagem sai no WhatsApp — nem para a loja, nem para cliente nenhuma.
--   * O link é pedido com enviar_whatsapp = false, pelo mesmo caminho que o
--     gatilho usa (segredo lido do cofre, nunca digitado).
--   * O item não aponta para produto nem variação: nada sai do estoque.
--   * O telefone é o que já recebe os avisos da loja, nunca o de uma cliente.
--
-- O QUE CONFERIR DEPOIS. Pagando o link no crédito à vista, em
-- payment_transactions a linha tem de sair com paid_amount_cents = 100, igual
-- a amount_cents. Se vier 104 ou parecido, a taxa continua indo para quem
-- compra e a publicação não pegou.
DO $teste$
DECLARE
  v_fone text;
  v_id   uuid;
  v_req  bigint;
  v_code text := 'TESTE-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DDMMHH24MI');
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
  VALUES (v_code, 'novo', 'TESTE PAGAMENTO ONLINE', v_fone, 'retirada', 1.00,
          'Pedido de teste do pagamento online (R$ 1,00) em 11/11/2026. Não é venda: nenhuma peça saiu do estoque e nenhuma mensagem foi enviada.')
  RETURNING id INTO v_id;

  INSERT INTO public.store_order_items
         (order_id, product_name, quantity, unit_price)
  VALUES (v_id, 'Teste de pagamento — não é peça', 1, 1.00);

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
$teste$;
