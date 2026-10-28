-- Estoque decide o que aparece na loja virtual.
--
-- Até aqui a loja (jmkmodas.com.br/loja) mostrava automaticamente toda peça
-- ativa, com foto, preço e estoque — não havia como deixar uma de fora sem
-- apagar a foto ou desativar o produto, o que atrapalha o PDV.
--
-- O padrão é continuar aparecendo: nada sai da vitrine por causa desta
-- migração. Quem não quiser na loja desmarca a opção no cadastro do produto.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS store_visible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.store_visible IS
  'Peça aparece na loja virtual. Desmarcada no Estoque, some da vitrine mas continua no PDV.';

-- Mesma consulta de antes, agora respeitando a escolha do Estoque.
CREATE OR REPLACE FUNCTION public.store_catalog()
RETURNS TABLE (
  id uuid, name text, description text, price numeric, image_url text,
  garment_type text, created_at timestamptz, variants jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.description, p.price, p.image_url, p.garment_type, p.created_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', v.id, 'size', v.size, 'color', v.color,
                    'quantity', LEAST(v.quantity, 10), 'image_url', v.image_url)
                  ORDER BY v.size NULLS LAST, v.color NULLS LAST)
             FROM product_variants v
            WHERE v.product_id = p.id AND v.quantity > 0
         ), '[]'::jsonb)
    FROM products p
   WHERE p.active AND NOT p.is_draft AND p.store_visible
     AND p.image_url IS NOT NULL AND p.price > 0
     AND (EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.quantity > 0)
          OR NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id))
   ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.store_catalog() FROM public;
GRANT EXECUTE ON FUNCTION public.store_catalog() TO anon, authenticated;

-- O pedido também passa a conferir: quem tiver o link antigo de uma peça
-- retirada da vitrine não consegue comprá-la pela loja. Função copiada da
-- migração 20260914180000 com essa única linha mudada.
CREATE OR REPLACE FUNCTION public.store_place_order(p_order jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name     text := btrim(coalesce(p_order->>'name', ''));
  v_phone    text := regexp_replace(coalesce(p_order->>'phone', ''), '\D', '', 'g');
  v_email    text := nullif(btrim(coalesce(p_order->>'email', '')), '');
  v_delivery text := coalesce(p_order->>'delivery_method', 'retirada');
  v_address  jsonb;
  v_order_id uuid;
  v_code     text;
  v_total    numeric := 0;
  v_units    int := 0;
  v_item     jsonb;
  v_qty      int;
  v_prod     record;
  v_var_id   uuid;
  v_size     text;
  v_color    text;
BEGIN
  IF length(v_name) < 2 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Informe seu nome';
  END IF;
  -- Guarda com DDI para o link do WhatsApp funcionar direto.
  IF length(v_phone) IN (10, 11) THEN v_phone := '55' || v_phone; END IF;
  IF length(v_phone) NOT IN (12, 13) THEN
    RAISE EXCEPTION 'Informe um WhatsApp válido com DDD';
  END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 160 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'E-mail inválido';
  END IF;
  IF v_delivery NOT IN ('retirada', 'entrega') THEN
    RAISE EXCEPTION 'Forma de entrega inválida';
  END IF;
  IF v_delivery = 'entrega' THEN
    -- Só as chaves conhecidas, com tamanho limitado: o jsonb vem do navegador.
    v_address := jsonb_strip_nulls(jsonb_build_object(
      'cep',          left(regexp_replace(coalesce(p_order->'address'->>'cep', ''), '\D', '', 'g'), 8),
      'street',       left(nullif(btrim(p_order->'address'->>'street'), ''), 120),
      'number',       left(nullif(btrim(p_order->'address'->>'number'), ''), 20),
      'complement',   left(nullif(btrim(p_order->'address'->>'complement'), ''), 80),
      'neighborhood', left(nullif(btrim(p_order->'address'->>'neighborhood'), ''), 80),
      'city',         left(nullif(btrim(p_order->'address'->>'city'), ''), 80),
      'state',        left(nullif(btrim(p_order->'address'->>'state'), ''), 2)
    ));
    IF length(coalesce(v_address->>'cep', '')) <> 8 OR v_address->>'street' IS NULL
       OR v_address->>'number' IS NULL OR v_address->>'city' IS NULL THEN
      RAISE EXCEPTION 'Informe o endereço de entrega completo';
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Seu carrinho está vazio';
  END IF;
  IF jsonb_array_length(p_items) > 20 THEN
    RAISE EXCEPTION 'Pedido com itens demais';
  END IF;

  IF (SELECT count(*) FROM store_orders
       WHERE customer_phone = v_phone AND status = 'novo'
         AND created_at > now() - interval '1 hour') >= 3 THEN
    RAISE EXCEPTION 'Você já tem pedidos aguardando confirmação. Vamos falar com você pelo WhatsApp.';
  END IF;
  IF (SELECT count(*) FROM store_orders
       WHERE status = 'novo' AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'Muitos pedidos no momento. Tente de novo em alguns minutos.';
  END IF;

  LOOP
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM store_orders WHERE code = v_code);
  END LOOP;

  INSERT INTO store_orders
    (code, customer_name, customer_phone, customer_email, delivery_method, address, notes)
  VALUES
    (v_code, v_name, v_phone, v_email, v_delivery, v_address,
     left(nullif(btrim(coalesce(p_order->>'notes', '')), ''), 500))
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 5 THEN
      RAISE EXCEPTION 'Quantidade inválida (máximo 5 por peça)';
    END IF;
    v_units := v_units + v_qty;

    SELECT id, name, price, cost INTO v_prod
      FROM products
     WHERE id = (v_item->>'product_id')::uuid AND active AND NOT is_draft AND store_visible AND price > 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uma das peças do carrinho não está mais disponível';
    END IF;

    IF nullif(v_item->>'variant_id', '') IS NOT NULL THEN
      UPDATE product_variants
         SET quantity = quantity - v_qty
       WHERE id = (v_item->>'variant_id')::uuid
         AND product_id = v_prod.id
         AND quantity >= v_qty
      RETURNING id, size, color INTO v_var_id, v_size, v_color;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Estoque insuficiente para %', v_prod.name;
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM product_variants WHERE product_id = v_prod.id) THEN
        RAISE EXCEPTION 'Escolha o tamanho e a cor de %', v_prod.name;
      END IF;
      v_var_id := NULL; v_size := NULL; v_color := NULL;
    END IF;

    INSERT INTO store_order_items
      (order_id, product_id, variant_id, product_name, size, color, quantity, unit_price, unit_cost)
    VALUES
      (v_order_id, v_prod.id, v_var_id, v_prod.name, v_size, v_color, v_qty, v_prod.price, v_prod.cost);

    v_total := v_total + v_prod.price * v_qty;
  END LOOP;

  IF v_units > 20 THEN
    RAISE EXCEPTION 'Máximo de 20 peças por pedido';
  END IF;

  UPDATE store_orders SET total = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('code', v_code, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.store_place_order(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.store_place_order(jsonb, jsonb) TO anon, authenticated;
