-- O aviso do pedido passa a pedir o link de pagamento.
--
-- Com o pagamento online ligado, quem fala com a cliente é a edge function
-- infinitepay-create-link: ela cria o link e manda UMA mensagem só, com a
-- confirmação do pedido e o link juntos. Duas mensagens seguidas (uma
-- confirmando, outra cobrando) seria ruim para quem compra.
--
-- Com o pagamento desligado — que é como o sistema fica até a chave da
-- InfinitePay entrar no cofre — nada muda: o gatilho manda a confirmação como
-- vinha mandando desde ontem.

-- ============ 1) Segredos que a loja pode ler ============
-- store_payment_secret autoriza o gatilho a chamar a função e protege a URL do
-- webhook; os outros dois são as credenciais da InfinitePay.
CREATE OR REPLACE FUNCTION public.get_internal_secret(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $fn$
BEGIN
  IF p_name NOT IN ('bubblewhats_webhook_secret', 'dunning_secret', 'report_secret', 'smtp_password',
                    'bubblewhats_device_id', 'bubblewhats_token',
                    'store_payment_secret', 'infinitepay_api_key', 'infinitepay_handle') THEN
    RAISE EXCEPTION 'segredo não permitido';
  END IF;
  RETURN (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1);
END;
$fn$;

-- Gerado aqui, ninguém digita.
SELECT vault.create_secret(
         replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
         'store_payment_secret',
         'Autoriza o gatilho a pedir link de pagamento e protege a URL do webhook da InfinitePay')
 WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'store_payment_secret');

-- ============ 2) O gatilho ============
CREATE OR REPLACE FUNCTION public.store_order_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $fn$
DECLARE
  v_device  text;
  v_token   text;
  v_url     text;
  v_loja    text;
  v_confirm boolean;
  v_link_on boolean;
  v_o       record;
  v_itens   text;
  v_itens_c text;
  v_msg     text;
  v_req     bigint;
  v_brl     text;
BEGIN
  SELECT decrypted_secret INTO v_device FROM vault.decrypted_secrets WHERE name = 'bubblewhats_device_id' LIMIT 1;
  SELECT decrypted_secret INTO v_token  FROM vault.decrypted_secrets WHERE name = 'bubblewhats_token'     LIMIT 1;

  IF coalesce(v_device, '') = '' OR coalesce(v_token, '') = '' THEN
    INSERT INTO public.whatsapp_send_failures (origem, endpoint, destino, http_status, detalhe)
    VALUES ('pedido-loja', '/send-message', NEW.code, 0,
            'BubbleWhats não configurado no cofre (bubblewhats_device_id / bubblewhats_token)');
    RETURN NULL;
  END IF;

  v_url := 'https://' || v_device || '.bubblewhats.com/send-message';

  SELECT o.code, o.customer_name, o.customer_phone, o.delivery_method, o.notes, o.total, o.address
    INTO v_o
    FROM public.store_orders o
   WHERE o.id = NEW.id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_brl := 'R$ ' || replace(to_char(v_o.total, 'FM9999999990.00'), '.', ',');

  SELECT string_agg(
           format('• %sx %s%s — R$ %s', i.quantity, i.product_name,
                  CASE WHEN coalesce(i.size, '') <> '' OR coalesce(i.color, '') <> ''
                       THEN ' (' || concat_ws(' · ', nullif(i.size, ''), nullif(i.color, '')) || ')'
                       ELSE '' END,
                  replace(to_char(i.unit_price * i.quantity, 'FM9999999990.00'), '.', ',')),
           chr(10) ORDER BY i.created_at),
         string_agg(
           format('• %sx %s%s', i.quantity, initcap(lower(i.product_name)),
                  CASE WHEN coalesce(i.size, '') <> '' OR coalesce(i.color, '') <> ''
                       THEN ' (' || concat_ws(' · ', nullif(i.size, ''), nullif(i.color, '')) || ')'
                       ELSE '' END),
           chr(10) ORDER BY i.created_at)
    INTO v_itens, v_itens_c
    FROM public.store_order_items i
   WHERE i.order_id = NEW.id;

  SELECT nullif(btrim(coalesce(s.order_alert_whatsapp, s.whatsapp, '')), ''),
         coalesce(s.order_confirm_customer, true),
         coalesce(s.payment_link_enabled, false)
    INTO v_loja, v_confirm, v_link_on
    FROM public.store_settings s
   LIMIT 1;

  -- ---- aviso para a loja ----
  IF v_loja IS NOT NULL THEN
    v_msg := '🛍️ *Pedido novo na loja virtual*' || chr(10)
          || 'Pedido #' || v_o.code || chr(10) || chr(10)
          || 'Cliente: ' || v_o.customer_name || chr(10)
          || 'WhatsApp: ' || v_o.customer_phone || chr(10)
          || 'Entrega: ' || CASE WHEN v_o.delivery_method = 'entrega' THEN 'receber em casa' ELSE 'retirar na loja' END
          || CASE WHEN v_o.delivery_method = 'entrega' AND v_o.address IS NOT NULL
                  THEN chr(10) || concat_ws(', ',
                         nullif(v_o.address->>'street', ''), nullif(v_o.address->>'number', ''),
                         nullif(v_o.address->>'complement', ''), nullif(v_o.address->>'neighborhood', ''),
                         nullif(v_o.address->>'city', ''), nullif(v_o.address->>'state', ''),
                         nullif(v_o.address->>'cep', ''))
                  ELSE '' END
          || chr(10) || chr(10) || coalesce(v_itens, '(sem itens)') || chr(10) || chr(10)
          || 'Total: ' || v_brl
          || CASE WHEN coalesce(btrim(v_o.notes), '') <> '' THEN chr(10) || chr(10) || 'Observação da cliente: ' || v_o.notes ELSE '' END
          || chr(10) || chr(10)
          || CASE WHEN v_link_on THEN 'Mandei o link de pagamento para ela.'
                  ELSE 'As peças já saíram do estoque. Confira em Pedidos da loja.' END;

    SELECT net.http_post(
             url := v_url,
             headers := jsonb_build_object('Authorization', v_token, 'Content-Type', 'application/json'),
             body := jsonb_build_object(
                       'jid', CASE WHEN v_loja LIKE '%@g.us' THEN v_loja
                                   ELSE regexp_replace(v_loja, '[^0-9]', '', 'g') END,
                       'message', v_msg),
             timeout_milliseconds := 20000)
      INTO v_req;

    INSERT INTO public.store_order_alerts (order_id, kind, destino, request_id)
    VALUES (NEW.id, 'loja', v_loja, v_req);
  END IF;

  -- ---- a cliente ----
  IF v_link_on THEN
    -- Quem fala com ela é a função do pagamento: a mensagem sai de lá já com o
    -- link. Se a InfinitePay falhar, a função avisa a loja pelo registro de
    -- falhas e o pedido segue normal — ninguém perde a venda por isso.
    SELECT net.http_post(
             url := 'https://ouwlrhculdfmlgguwezw.supabase.co/functions/v1/infinitepay-create-link',
             headers := jsonb_build_object(
                          'Content-Type', 'application/json',
                          'x-store-payment-secret',
                          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'store_payment_secret' LIMIT 1)),
             body := jsonb_build_object('order_id', NEW.id),
             timeout_milliseconds := 30000)
      INTO v_req;

    INSERT INTO public.store_order_alerts (order_id, kind, destino, request_id)
    VALUES (NEW.id, 'link-pagamento', coalesce(v_o.customer_phone, '-'), v_req);

  ELSIF v_confirm AND coalesce(v_o.customer_phone, '') <> '' THEN
    v_msg := 'Olá, ' || initcap(lower(split_part(v_o.customer_name, ' ', 1)))
          || '! Recebemos seu pedido na *JMK Modas* 💛' || chr(10)
          || 'Pedido #' || v_o.code || chr(10) || chr(10)
          || coalesce(v_itens_c, '') || chr(10) || chr(10)
          || 'Total: ' || v_brl || chr(10) || chr(10)
          || 'Suas peças já estão reservadas. '
          || CASE WHEN v_o.delivery_method = 'entrega'
                  THEN 'Em breve falamos com você para combinar o pagamento e o frete.'
                  ELSE 'Em breve falamos com você para combinar o pagamento e a retirada.' END;

    SELECT net.http_post(
             url := v_url,
             headers := jsonb_build_object('Authorization', v_token, 'Content-Type', 'application/json'),
             body := jsonb_build_object('jid', regexp_replace(v_o.customer_phone, '[^0-9]', '', 'g'),
                                        'message', v_msg),
             timeout_milliseconds := 20000)
      INTO v_req;

    INSERT INTO public.store_order_alerts (order_id, kind, destino, request_id)
    VALUES (NEW.id, 'cliente', v_o.customer_phone, v_req);
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.whatsapp_send_failures (origem, endpoint, destino, http_status, detalhe)
    VALUES ('pedido-loja', '/send-message', NEW.code, 0, left(SQLERRM, 500));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END;
$fn$;
