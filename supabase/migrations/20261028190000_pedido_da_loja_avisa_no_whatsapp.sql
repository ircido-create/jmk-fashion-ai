-- Pedido da loja virtual avisa no WhatsApp.
--
-- Até aqui fechar a sacola só gravava o pedido e mostrava um botão "Falar com a
-- loja" — que depende da cliente clicar. Na prática a loja não ficava sabendo
-- de nada: o pedido esperava alguém abrir a tela "Pedidos da loja".
--
-- Agora o próprio banco avisa, assim que o pedido fecha:
--   • para a loja, o pedido inteiro (cliente, telefone, peças, total);
--   • para a cliente, a confirmação com o código e o total.
--
-- O envio sai do mesmo aparelho do BubbleWhats que a Mônica usa. O gatilho é
-- DEFERRABLE INITIALLY DEFERRED de propósito: roda no fim da transação, com os
-- itens e o total já gravados, e nada é enviado se o pedido não for em frente.
-- Falha de envio nunca derruba o pedido — a venda importa mais que o aviso.

-- ============ 1) Para onde vai o aviso ============
-- Em branco, usa o WhatsApp público da loja (store_settings.whatsapp). Pode ser
-- outro número da equipe ou um grupo (JID terminado em @g.us).
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS order_alert_whatsapp text;

COMMENT ON COLUMN public.store_settings.order_alert_whatsapp IS
  'Quem recebe o aviso de pedido novo. Vazio = o WhatsApp público da loja.';

-- Confirmação para a cliente: ligada, mas desligável sem mexer em código.
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS order_confirm_customer boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.store_settings.order_confirm_customer IS
  'Manda a confirmação do pedido para a própria cliente pelo WhatsApp.';

-- ============ 2) Rastro dos avisos ============
-- pg_net envia depois do commit; guardar o request_id é o que permite saber
-- mais tarde se a mensagem saiu (net._http_response) sem ficar adivinhando.
CREATE TABLE IF NOT EXISTS public.store_order_alerts (
  id         bigserial PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES public.store_orders(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('loja', 'cliente')),
  destino    text NOT NULL,
  request_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_order_alerts_order_idx ON public.store_order_alerts (order_id, created_at DESC);

ALTER TABLE public.store_order_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "equipe ve avisos de pedido" ON public.store_order_alerts;
CREATE POLICY "equipe ve avisos de pedido" ON public.store_order_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'vendedor'::public.app_role));
REVOKE ALL ON public.store_order_alerts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.store_order_alerts FROM authenticated;

-- ============ 3) O aviso ============
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

  -- Relê o pedido: com o gatilho adiado, o total e os itens aqui já são os finais.
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
         coalesce(s.order_confirm_customer, true)
    INTO v_loja, v_confirm
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
          || chr(10) || chr(10) || 'As peças já saíram do estoque. Confira em Pedidos da loja.';

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

  -- ---- confirmação para a cliente ----
  IF v_confirm AND coalesce(v_o.customer_phone, '') <> '' THEN
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
  -- O pedido está feito e o estoque reservado: um aviso que falhou não desfaz isso.
  BEGIN
    INSERT INTO public.whatsapp_send_failures (origem, endpoint, destino, http_status, detalhe)
    VALUES ('pedido-loja', '/send-message', NEW.code, 0, left(SQLERRM, 500));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.store_order_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_store_order_notify ON public.store_orders;
CREATE CONSTRAINT TRIGGER trg_store_order_notify
  AFTER INSERT ON public.store_orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.store_order_notify();
