-- Quando o pedido expira, a cliente fica sabendo.
--
-- A rotina de 12/11 (migração 20261112120000) devolve à loja as peças de
-- pedido não pago depois de 12 horas. Até aqui ela fazia isso em silêncio: a
-- cliente tinha recebido "Suas peças já estão reservadas" e nunca mais ouvia
-- falar do assunto — e, se voltasse para pagar, a peça podia já ter sido
-- vendida para outra pessoa.
--
-- O QUE MUDA. Ao expirar um pedido, a rotina manda uma mensagem para a cliente
-- pelo mesmo caminho do aviso de pedido novo (BubbleWhats, segredos no cofre),
-- com o número do pedido, as peças que saíram e o convite para refazer. O envio
-- fica registrado em store_order_alerts com kind 'pedido-expirado', e a falha
-- de envio em whatsapp_send_failures.
--
-- A mensagem sai uma única vez por pedido: a rotina só pega pedidos 'novo', e
-- o pedido já sai dela como 'cancelado'.
--
-- Um aviso que não sai NÃO desfaz a devolução das peças: o envio está em bloco
-- próprio, com o erro registrado e a rotina seguindo adiante. É a mesma regra
-- do aviso de pedido novo.
--
-- Autorizado pelo José em 12/11/2026.

-- ============ 1) o novo tipo de aviso ============
ALTER TABLE public.store_order_alerts DROP CONSTRAINT IF EXISTS store_order_alerts_kind_check;
ALTER TABLE public.store_order_alerts
  ADD CONSTRAINT store_order_alerts_kind_check
  CHECK (kind IN ('loja', 'cliente', 'link-pagamento', 'pagamento-confirmado', 'pedido-expirado'));

-- ============ 2) a rotina, agora avisando ============
-- O resto é igual à versão de 20261112120000: mesma seleção de pedidos, mesma
-- devolução ao estoque, mesma nota no pedido e na cobrança.
CREATE OR REPLACE FUNCTION public.store_expire_unpaid_orders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $fn$
DECLARE
  v_horas  int;
  v_order  record;
  v_item   store_order_items%ROWTYPE;
  v_qtd    int := 0;
  v_device text;
  v_token  text;
  v_url    text;
  v_itens  text;
  v_msg    text;
  v_req    bigint;
BEGIN
  SELECT coalesce(reserve_hours, 12) INTO v_horas FROM store_settings LIMIT 1;
  v_horas := coalesce(v_horas, 12);

  SELECT decrypted_secret INTO v_device FROM vault.decrypted_secrets WHERE name = 'bubblewhats_device_id' LIMIT 1;
  SELECT decrypted_secret INTO v_token  FROM vault.decrypted_secrets WHERE name = 'bubblewhats_token'     LIMIT 1;
  IF coalesce(v_device, '') <> '' THEN
    v_url := 'https://' || v_device || '.bubblewhats.com/send-message';
  END IF;

  -- NOT EXISTS, e não um LEFT JOIN: se um pedido tivesse duas cobranças, o
  -- join o traria duas vezes e o estoque voltaria dobrado.
  FOR v_order IN
    SELECT o.id, o.code, o.notes, o.customer_name, o.customer_phone
      FROM store_orders o
     WHERE o.status = 'novo'
       AND o.created_at < now() - make_interval(hours => v_horas)
       AND NOT EXISTS (SELECT 1 FROM payment_charges c
                        WHERE c.order_id = o.id AND c.status IN ('pago', 'estornado'))
     ORDER BY o.created_at
     FOR UPDATE
  LOOP
    FOR v_item IN SELECT * FROM store_order_items WHERE order_id = v_order.id LOOP
      IF v_item.variant_id IS NOT NULL THEN
        UPDATE product_variants SET quantity = quantity + v_item.quantity
         WHERE id = v_item.variant_id;
      ELSIF v_item.product_id IS NOT NULL AND (v_item.size IS NOT NULL OR v_item.color IS NOT NULL) THEN
        UPDATE product_variants SET quantity = quantity + v_item.quantity
         WHERE id = (SELECT id FROM product_variants
                      WHERE product_id = v_item.product_id
                        AND size IS NOT DISTINCT FROM v_item.size
                        AND color IS NOT DISTINCT FROM v_item.color
                      ORDER BY created_at
                      LIMIT 1);
      END IF;
    END LOOP;

    UPDATE store_orders
       SET status = 'cancelado',
           notes = left(
             coalesce(v_order.notes || ' | ', '')
             || 'Expirado automaticamente em '
             || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
             || ': ' || v_horas || 'h sem pagamento. As peças voltaram ao estoque.', 1000),
           updated_at = now()
     WHERE id = v_order.id;

    UPDATE payment_charges
       SET status = 'expirado', updated_at = now()
     WHERE order_id = v_order.id
       AND status NOT IN ('pago', 'estornado', 'expirado');

    -- ---- aviso para a cliente ----
    BEGIN
      IF coalesce(v_order.customer_phone, '') = '' THEN
        NULL;  -- pedido sem telefone: não há para onde mandar
      ELSIF coalesce(v_device, '') = '' OR coalesce(v_token, '') = '' THEN
        INSERT INTO public.whatsapp_send_failures (origem, endpoint, destino, http_status, detalhe)
        VALUES ('pedido-expirado', '/send-message', v_order.code, 0,
                'BubbleWhats não configurado no cofre (bubblewhats_device_id / bubblewhats_token)');
      ELSE
        SELECT string_agg(
                 format('• %sx %s%s', i.quantity, initcap(lower(i.product_name)),
                        CASE WHEN coalesce(i.size, '') <> '' OR coalesce(i.color, '') <> ''
                             THEN ' (' || concat_ws(' · ', nullif(i.size, ''), nullif(i.color, '')) || ')'
                             ELSE '' END),
                 chr(10) ORDER BY i.created_at)
          INTO v_itens
          FROM store_order_items i
         WHERE i.order_id = v_order.id;

        v_msg := 'Oi, ' || initcap(lower(split_part(coalesce(v_order.customer_name, ''), ' ', 1))) || '! 💛' || chr(10) || chr(10)
              || 'Seu pedido #' || v_order.code || ' na *JMK Modas* expirou: ficou '
              || v_horas || ' horas sem o pagamento, e as peças voltaram para a loja.' || chr(10) || chr(10)
              || coalesce(v_itens, '') || chr(10) || chr(10)
              || 'Se você ainda quiser, é só fazer o pedido de novo na loja virtual, enquanto a peça estiver no estoque. '
              || 'Qualquer dúvida, é só chamar aqui 😊';

        SELECT net.http_post(
                 url := v_url,
                 headers := jsonb_build_object('Authorization', v_token, 'Content-Type', 'application/json'),
                 body := jsonb_build_object(
                           'jid', regexp_replace(v_order.customer_phone, '[^0-9]', '', 'g'),
                           'message', v_msg),
                 timeout_milliseconds := 20000)
          INTO v_req;

        INSERT INTO public.store_order_alerts (order_id, kind, destino, request_id)
        VALUES (v_order.id, 'pedido-expirado', v_order.customer_phone, v_req);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- As peças já voltaram ao estoque: um aviso que falhou não desfaz isso.
      BEGIN
        INSERT INTO public.whatsapp_send_failures (origem, endpoint, destino, http_status, detalhe)
        VALUES ('pedido-expirado', '/send-message', v_order.code, 0, left(SQLERRM, 500));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;

    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN v_qtd;
END;
$fn$;

COMMENT ON FUNCTION public.store_expire_unpaid_orders() IS
  'Devolve à loja as peças de pedidos não pagos mais velhos que store_settings.reserve_hours, avisa a cliente no WhatsApp e devolve quantos pedidos expirou.';

REVOKE ALL ON FUNCTION public.store_expire_unpaid_orders() FROM public, anon, authenticated;

-- ============ 3) conferências ============
DO $confere$
DECLARE
  v_presos int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jmk-loja-expira-pedidos') THEN
    RAISE EXCEPTION 'A rotina de hora em hora sumiu do agendamento.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'store_order_alerts_kind_check'
       AND pg_get_constraintdef(oid) LIKE '%pedido-expirado%') THEN
    RAISE EXCEPTION 'O tipo de aviso "pedido-expirado" não entrou na tabela.';
  END IF;

  -- a rotina continua funcionando: nenhum pedido vencido ficou para trás
  v_presos := public.store_expire_unpaid_orders();
  IF v_presos <> 0 THEN
    RAISE NOTICE 'A rotina expirou % pedido(s) agora.', v_presos;
  END IF;
END
$confere$;
