-- Pedido da loja que não foi pago devolve a peça para a vitrine sozinho.
--
-- O QUE ACONTECEU. Em 11/11/2026, às 15:15, a cido fechou o carrinho com o
-- Vestido Tubo Elaine (M PRETO), pedido 0B8769, R$ 150,00. O link de pagamento
-- ficou "aguardando" e ela nunca pagou. Mesmo assim a peça saiu do estoque na
-- hora do pedido — era a última M PRETO — e o vestido sumiu da loja virtual.
-- No dia seguinte o José reparou: "VENDA NAO FINALIZADA E PRODUTO SAIU DA LOJA".
--
-- POR QUE PASSOU. store_place_order baixa o estoque no momento do pedido, o que
-- está certo: é o que impede duas clientes comprarem a mesma peça única. O que
-- falta é o outro lado. O status 'expirado' existe na tabela payment_charges
-- desde 29/10, mas NADA no sistema marca uma cobrança como expirada nem desfaz
-- o pedido. Sem alguém cancelar na tela de Pedidos, a peça fica reservada para
-- sempre por quem não pagou.
--
-- O QUE MUDA. Uma rotina de hora em hora desfaz o pedido parado:
--   * pedido ainda 'novo' (não virou venda),
--   * mais velho que o prazo da loja (store_settings.reserve_hours, 12 h),
--   * sem pagamento confirmado — cobrança 'pago' ou 'estornado' nunca expira,
--     e pedido sem cobrança nenhuma conta pelo tempo do pedido.
-- Para cada um: as peças voltam ao estoque (mesma devolução do cancelamento
-- feito na tela), o pedido fica 'cancelado' com a nota dizendo que expirou, e
-- a cobrança fica 'expirado'.
--
-- O prazo é das 12 horas que o José escolheu em 12/11/2026, e fica numa coluna
-- para mudar sem mexer em código: UPDATE store_settings SET reserve_hours = 24.
--
-- A rotina NÃO manda mensagem para ninguém. Avisar a cliente de que o pedido
-- expirou é outro pedido, e ainda não foi autorizado.

-- ============ 1) o prazo que a loja segura a peça ============
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS reserve_hours int NOT NULL DEFAULT 12;

COMMENT ON COLUMN public.store_settings.reserve_hours IS
  'Horas que um pedido não pago segura a peça antes de a rotina devolvê-la à loja.';

DO $limite$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_settings_reserve_hours_check') THEN
    ALTER TABLE public.store_settings
      ADD CONSTRAINT store_settings_reserve_hours_check
      CHECK (reserve_hours BETWEEN 1 AND 720);
  END IF;
END
$limite$;

-- ============ 2) a rotina ============
-- Roda sem ninguém logado (pg_cron), por isso não passa por store_update_order,
-- que exige papel de admin ou vendedor. A devolução ao estoque é a mesma: pela
-- variação, e pela etiqueta tamanho/cor quando a variação foi recriada numa
-- edição do produto.
CREATE OR REPLACE FUNCTION public.store_expire_unpaid_orders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_horas int;
  v_order record;
  v_item  store_order_items%ROWTYPE;
  v_qtd   int := 0;
BEGIN
  SELECT coalesce(reserve_hours, 12) INTO v_horas FROM store_settings LIMIT 1;
  v_horas := coalesce(v_horas, 12);

  FOR v_order IN
    -- NOT EXISTS, e não um LEFT JOIN: se um pedido tivesse duas cobranças, o
    -- join o traria duas vezes e o estoque voltaria dobrado.
    SELECT o.id, o.code, o.notes
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

    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN v_qtd;
END;
$fn$;

COMMENT ON FUNCTION public.store_expire_unpaid_orders() IS
  'Devolve à loja as peças de pedidos não pagos mais velhos que store_settings.reserve_hours. Devolve quantos pedidos expirou.';

REVOKE ALL ON FUNCTION public.store_expire_unpaid_orders() FROM public, anon, authenticated;

-- ============ 3) de hora em hora ============
-- Para desligar: SELECT cron.unschedule('jmk-loja-expira-pedidos');
SELECT cron.unschedule('jmk-loja-expira-pedidos')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jmk-loja-expira-pedidos');

SELECT cron.schedule('jmk-loja-expira-pedidos', '20 * * * *',
                     $cron$SELECT public.store_expire_unpaid_orders();$cron$);

-- ============ 4) o pedido 0B8769, que começou tudo ============
-- Autorizado pelo José em 12/11/2026: cancelar e devolver a peça à loja.
-- A própria rotina faz o serviço, porque o pedido já passou das 12 horas.
DO $agora$
DECLARE
  v_estoque_antes int;
  v_estoque_depois int;
  v_situacao text;
  v_expirados int;
BEGIN
  SELECT v.quantity INTO v_estoque_antes
    FROM store_order_items i
    JOIN product_variants v ON v.id = i.variant_id
    JOIN store_orders o ON o.id = i.order_id
   WHERE o.code = '0B8769';

  v_expirados := public.store_expire_unpaid_orders();

  SELECT o.status INTO v_situacao FROM store_orders o WHERE o.code = '0B8769';

  SELECT v.quantity INTO v_estoque_depois
    FROM store_order_items i
    JOIN product_variants v ON v.id = i.variant_id
    JOIN store_orders o ON o.id = i.order_id
   WHERE o.code = '0B8769';

  IF v_situacao IS DISTINCT FROM 'cancelado' THEN
    RAISE EXCEPTION 'O pedido 0B8769 continua como "%" — a rotina não o pegou.', v_situacao;
  END IF;

  IF v_estoque_depois IS DISTINCT FROM v_estoque_antes + 1 THEN
    RAISE EXCEPTION 'A peça não voltou ao estoque: antes %, depois % (esperado %).',
      v_estoque_antes, v_estoque_depois, v_estoque_antes + 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM store_catalog() c
                  JOIN store_order_items i ON i.product_id = c.id
                  JOIN store_orders o ON o.id = i.order_id
                 WHERE o.code = '0B8769') THEN
    RAISE EXCEPTION 'A peça voltou ao estoque mas continua fora da vitrine.';
  END IF;

  RAISE NOTICE 'Pedidos expirados agora: %. O Vestido Tubo Elaine voltou para a loja (estoque % -> %).',
    v_expirados, v_estoque_antes, v_estoque_depois;
END
$agora$;

-- ============ 5) conferências ============
DO $confere$
DECLARE
  v_horas int;
  v_presos int;
BEGIN
  SELECT reserve_hours INTO v_horas FROM store_settings LIMIT 1;
  IF v_horas <> 12 THEN
    RAISE EXCEPTION 'O prazo da loja ficou em % horas (esperado 12).', v_horas;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jmk-loja-expira-pedidos') THEN
    RAISE EXCEPTION 'A rotina de hora em hora não ficou agendada.';
  END IF;

  SELECT count(*) INTO v_presos
    FROM store_orders o
   WHERE o.status = 'novo'
     AND o.created_at < now() - make_interval(hours => v_horas)
     AND NOT EXISTS (SELECT 1 FROM payment_charges c
                      WHERE c.order_id = o.id AND c.status IN ('pago', 'estornado'));

  IF v_presos > 0 THEN
    RAISE EXCEPTION 'Sobraram % pedidos não pagos segurando peça.', v_presos;
  END IF;
END
$confere$;
