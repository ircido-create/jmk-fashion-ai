-- A confirmação do pedido passa a dizer por quanto tempo a peça fica guardada.
--
-- POR QUÊ. Desde 12/11 uma rotina devolve à loja as peças de pedido não pago
-- depois do prazo da loja (store_settings.reserve_hours, 12 horas), e avisa a
-- cliente quando isso acontece (migrações 20261112120000 e 20261112140000). Só
-- que a mensagem que ela recebia ao fechar o pedido dizia apenas "Suas peças já
-- estão reservadas", sem prazo nenhum — então o aviso de expiração chegava como
-- surpresa. O José pediu em 12/11/2026: "poe o prazo na mensagem".
--
-- O QUE MUDA.
--   1. A confirmação do pedido diz o prazo, lendo o mesmo reserve_hours que a
--      rotina usa. Mudar o prazo (UPDATE store_settings SET reserve_hours = 24)
--      muda a mensagem no mesmo instante, sem mexer em código.
--   2. A loja virtual (que roda sem login) pode ler essa coluna, para as telas
--      do carrinho e do "pedido recebido" mostrarem o mesmo prazo. É dado
--      público: só diz quanto tempo a peça fica guardada.
--
-- ATENÇÃO, A OUTRA MENSAGEM. Com o pagamento online ligado
-- (store_settings.payment_link_enabled), quem fala com a cliente não é este
-- gatilho: é a edge function infinitepay-create-link, que manda a confirmação
-- junto com o link. O texto dela está em
-- supabase/functions/infinitepay-create-link/index.ts e só passa a valer depois
-- de a função ser publicada — isso não vem pelo GitHub. As conferências no fim
-- desta migração dizem qual das duas rotas está ligada hoje.
--
-- Nada mais muda: mesmo aviso para a loja, mesma chamada do link de pagamento,
-- mesmo registro em store_order_alerts.
--
-- Autorizado pelo José em 12/11/2026.

-- ============ 1) a loja pode ler o prazo ============
GRANT SELECT (reserve_hours) ON public.store_settings TO anon, authenticated;

-- ============ 2) o gatilho ============
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
  v_horas   int;
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
         coalesce(s.payment_link_enabled, false),
         coalesce(s.reserve_hours, 12)
    INTO v_loja, v_confirm, v_link_on, v_horas
    FROM public.store_settings s
   LIMIT 1;

  v_horas := coalesce(v_horas, 12);

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
          || 'Guardamos suas peças por ' || v_horas || ' horas. '
          || CASE WHEN v_o.delivery_method = 'entrega'
                  THEN 'Em breve falamos com você para combinar o pagamento e o frete.'
                  ELSE 'Em breve falamos com você para combinar o pagamento e a retirada.' END
          || chr(10) || chr(10)
          || 'Se o pagamento não entrar nesse prazo, as peças voltam para a loja — e aí é só pedir de novo 😊';

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

REVOKE ALL ON FUNCTION public.store_order_notify() FROM PUBLIC, anon, authenticated;

-- ============ 3) conferências ============
DO $confere$
DECLARE
  v_corpo   text;
  v_link_on boolean;
  v_horas   int;
  v_lig     char;
BEGIN
  SELECT p.prosrc INTO v_corpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'store_order_notify';

  IF v_corpo IS NULL THEN
    RAISE EXCEPTION 'O gatilho store_order_notify não existe.';
  END IF;

  IF v_corpo NOT LIKE '%Guardamos suas peças por%' THEN
    RAISE EXCEPTION 'O prazo não entrou na mensagem da cliente.';
  END IF;

  -- o gatilho tem de estar ligado: as migrações de teste de pagamento
  -- (20261111210000 e 20261111214500) o desligam e religam
  SELECT t.tgenabled INTO v_lig
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'store_orders' AND t.tgname = 'trg_store_order_notify';

  IF v_lig IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'O gatilho do aviso está desligado (tgenabled = %).', coalesce(v_lig::text, 'não existe');
  END IF;

  IF NOT has_column_privilege('anon', 'public.store_settings', 'reserve_hours', 'SELECT') THEN
    RAISE EXCEPTION 'A loja não consegue ler o prazo.';
  END IF;

  -- a loja continua sem ver o que não é dela
  IF has_column_privilege('anon', 'public.store_settings', 'order_alert_whatsapp', 'SELECT')
     OR has_column_privilege('anon', 'public.store_settings', 'payment_link_enabled', 'SELECT') THEN
    RAISE EXCEPTION 'A loja passou a ver coluna que não é pública.';
  END IF;

  SELECT coalesce(payment_link_enabled, false), coalesce(reserve_hours, 12)
    INTO v_link_on, v_horas
    FROM public.store_settings LIMIT 1;

  RAISE NOTICE 'Prazo da loja: % horas.', v_horas;
  IF v_link_on THEN
    RAISE NOTICE 'Pagamento online LIGADO: quem manda a confirmação é a edge function infinitepay-create-link. O prazo só aparece na mensagem depois de a função ser publicada.';
  ELSE
    RAISE NOTICE 'Pagamento online desligado: a confirmação sai deste gatilho, já com o prazo.';
  END IF;
END
$confere$;
