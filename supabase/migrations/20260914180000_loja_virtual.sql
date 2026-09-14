-- Loja virtual: vitrine pública, pedidos online e provador com IA.
--
-- Tudo aqui é aditivo: nenhuma tabela, coluna ou política existente muda. A
-- loja não tem login de cliente, então o público (anon) nunca toca tabela
-- nenhuma diretamente — lê o catálogo e grava pedidos por funções que expõem só
-- o que é público (sem custo, fornecedor ou SKU) e conferem preço e estoque no
-- servidor. Preço vindo do navegador não é aceito em lugar nenhum.

-- ============ 1) Tipo de peça ============
-- Define a seção da vitrine e a parte do corpo que a peça veste no provador.
-- Nulo = ainda não classificado: aparece na loja, mas fica fora do provador.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS garment_type text
  CHECK (garment_type IN ('blusa', 'saia', 'calca', 'vestido', 'conjunto', 'outro'));

-- Pré-classificação pelo nome, só onde ainda está vazio. É um palpite para
-- poupar a revisão de ~600 cadastros um a um; o cadastro corrige o que errar.
-- A ordem importa: "CONJUNTO BLUSA E SAIA" é conjunto, "CHEMISE" é vestido.
-- O gatilho de updated_at fica desligado: reclassificar não é editar o produto,
-- e mexer na data reordenaria listas que usam esse campo.
ALTER TABLE public.products DISABLE TRIGGER trg_products_updated;
UPDATE public.products SET garment_type = CASE
    WHEN upper(name) ~ '\mCONJ' THEN 'conjunto'
    WHEN upper(name) ~ '\m(VESTIDO|VEST|CHEMISE|CHEMISSE|CHEMISSIE|CHAMISE|TUBINHO|TUB)\M' THEN 'vestido'
    WHEN upper(name) ~ '\mSAIA' THEN 'saia'
    WHEN upper(name) ~ '\mCAL[CÇ]A' THEN 'calca'
    WHEN upper(name) ~ '\m(BLUSA|BL|CAMISA|CAMISETE|CAMISETA|T-SHIRT|BATA|REGATA|TOP|BODY|CROPPED|JAQUETA|CASACO|CASAQUINHO|BLAZER|COLETE|KIMONO|CARDIG|SUETER|SUÉTER|SOBRETUDO|TRICOT|MOLETOM)' THEN 'blusa'
  END
WHERE garment_type IS NULL;
ALTER TABLE public.products ENABLE TRIGGER trg_products_updated;

-- ============ 2) Configuração pública da loja ============
-- Linha única. Só guarda o que pode aparecer para qualquer visitante.
CREATE TABLE IF NOT EXISTS public.store_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  whatsapp       text,
  pickup_address text,
  delivery_note  text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.store_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Loja lê configurações públicas" ON public.store_settings
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Equipe edita configurações da loja" ON public.store_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'vendedor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'vendedor'));
REVOKE INSERT, DELETE ON public.store_settings FROM anon, authenticated;

-- ============ 3) Pedidos ============
CREATE TABLE IF NOT EXISTS public.store_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'novo'
                  CHECK (status IN ('novo', 'confirmado', 'entregue', 'cancelado')),
  customer_name   text NOT NULL,
  customer_phone  text NOT NULL,
  customer_email  text,
  delivery_method text NOT NULL CHECK (delivery_method IN ('retirada', 'entrega')),
  address         jsonb,
  notes           text,
  total           numeric(12,2) NOT NULL DEFAULT 0,
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  sale_id         uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_orders_status_created_idx ON public.store_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS store_orders_phone_created_idx ON public.store_orders (customer_phone, created_at DESC);

-- product_id/variant_id seguem o padrão de sale_items (SET NULL): o cadastro de
-- produto apaga e recria as variações a cada edição, e uma FK restritiva
-- impediria salvar o produto. Tamanho e cor ficam copiados para o estorno achar
-- a variação recriada.
CREATE TABLE IF NOT EXISTS public.store_order_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES public.store_orders(id) ON DELETE CASCADE,
  product_id   uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id   uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  size         text,
  color        text,
  quantity     int NOT NULL CHECK (quantity > 0),
  unit_price   numeric(12,2) NOT NULL,
  unit_cost    numeric(12,2) NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_order_items_order_idx ON public.store_order_items (order_id);

ALTER TABLE public.store_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe vê pedidos da loja" ON public.store_orders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'vendedor'));
CREATE POLICY "Equipe vê itens dos pedidos da loja" ON public.store_order_items
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'vendedor'));
-- Sem política de escrita de propósito: criar, confirmar e cancelar passam pelas
-- funções abaixo, que movem estoque e venda junto com a situação do pedido.
REVOKE ALL ON public.store_orders, public.store_order_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.store_orders, public.store_order_items FROM authenticated;

-- ============ 4) Uso do provador ============
-- Contagem para o limite de gerações de IA. Guarda o hash do IP, nunca o IP nem
-- a foto. Só a edge function (service role) lê e grava.
CREATE TABLE IF NOT EXISTS public.store_tryon_usage (
  id         bigserial PRIMARY KEY,
  client_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_tryon_usage_key_idx ON public.store_tryon_usage (client_key, created_at DESC);
CREATE INDEX IF NOT EXISTS store_tryon_usage_created_idx ON public.store_tryon_usage (created_at DESC);
ALTER TABLE public.store_tryon_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_tryon_usage FROM anon, authenticated;

-- ============ 5) Catálogo público ============
-- Só o que está à venda de verdade: ativo, publicado, com foto, com preço e com
-- estoque (ou sem variações, que o PDV também trata como disponível). A
-- quantidade exposta é limitada a 10: basta para "últimas peças" sem revelar o
-- estoque inteiro da loja.
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
   WHERE p.active AND NOT p.is_draft AND p.image_url IS NOT NULL AND p.price > 0
     AND (EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.quantity > 0)
          OR NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id))
   ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.store_catalog() FROM public;
GRANT EXECUTE ON FUNCTION public.store_catalog() TO anon, authenticated;

-- ============ 6) Fazer pedido ============
-- Reserva o estoque na hora (mesma trava do create_sale: a condição no WHERE
-- impede estoque negativo mesmo com PDV e loja vendendo a mesma peça ao mesmo
-- tempo). O preço é sempre o do cadastro. Os freios limitam o estrago de quem
-- tentar esvaziar o estoque com pedidos falsos: cancelar no painel devolve tudo.
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
     WHERE id = (v_item->>'product_id')::uuid AND active AND NOT is_draft AND price > 0;
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

-- ============ 7) Andamento do pedido (painel) ============
-- novo → confirmado: vira venda (entra no Painel, em Vendas e nos relatórios),
--   com o cliente achado pelo telefone ou cadastrado. O estoque já foi baixado
--   na reserva, então a venda não mexe nele.
-- novo → cancelado: devolve as peças ao estoque.
-- confirmado → entregue: só registra.
-- Pedido confirmado não é cancelado aqui: ele já é uma venda, e excluir a venda
-- em Vendas é o caminho que estorna estoque e parcelas de uma vez só.
CREATE OR REPLACE FUNCTION public.store_update_order(
  p_order_id uuid,
  p_status text,
  p_payment_method text DEFAULT 'pix'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order    store_orders%ROWTYPE;
  v_item     store_order_items%ROWTYPE;
  v_customer uuid;
  v_sale     uuid;
  v_address  text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'vendedor')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO v_order FROM store_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;

  IF p_status = 'confirmado' THEN
    IF v_order.status <> 'novo' THEN
      RAISE EXCEPTION 'Só pedidos novos podem ser confirmados';
    END IF;
    IF p_payment_method NOT IN ('pix', 'dinheiro', 'debito', 'credito') THEN
      RAISE EXCEPTION 'Forma de pagamento inválida';
    END IF;

    -- Os telefones do cadastro vêm em formatos variados (+55 11 9..., 5511...):
    -- compara os 11 últimos dígitos, que são DDD + número.
    SELECT id INTO v_customer
      FROM customers
     WHERE phone IS NOT NULL
       AND right(regexp_replace(phone, '\D', '', 'g'), 11) = right(v_order.customer_phone, 11)
     ORDER BY created_at
     LIMIT 1;

    IF v_customer IS NULL THEN
      IF v_order.address IS NOT NULL THEN
        v_address := concat_ws(', ',
          v_order.address->>'street', v_order.address->>'number', v_order.address->>'complement',
          v_order.address->>'neighborhood',
          concat_ws('/', v_order.address->>'city', v_order.address->>'state'),
          'CEP ' || (v_order.address->>'cep'));
      END IF;
      INSERT INTO customers (name, phone, email, address, notes)
      VALUES (v_order.customer_name, v_order.customer_phone, v_order.customer_email, v_address,
              'Cadastrado pela loja virtual')
      RETURNING id INTO v_customer;
    END IF;

    INSERT INTO sales (customer_id, total, notes, sale_date, payment_method, installments)
    VALUES (v_customer, v_order.total, 'Loja virtual — pedido #' || v_order.code, now(), p_payment_method, 1)
    RETURNING id INTO v_sale;

    INSERT INTO sale_items
      (sale_id, product_id, variant_id, product_name, variant_label, quantity, unit_price, unit_cost)
    SELECT v_sale, product_id, variant_id, product_name,
           nullif(concat_ws(' / ', size, color), ''), quantity, unit_price, unit_cost
      FROM store_order_items
     WHERE order_id = p_order_id;

    UPDATE store_orders
       SET status = 'confirmado', customer_id = v_customer, sale_id = v_sale, updated_at = now()
     WHERE id = p_order_id;

  ELSIF p_status = 'entregue' THEN
    IF v_order.status <> 'confirmado' THEN
      RAISE EXCEPTION 'Confirme o pedido antes de marcar como entregue';
    END IF;
    UPDATE store_orders SET status = 'entregue', updated_at = now() WHERE id = p_order_id;

  ELSIF p_status = 'cancelado' THEN
    IF v_order.status <> 'novo' THEN
      RAISE EXCEPTION 'Este pedido já virou venda. Para desfazer, exclua a venda em Vendas — ela devolve as peças ao estoque.';
    END IF;

    FOR v_item IN SELECT * FROM store_order_items WHERE order_id = p_order_id LOOP
      IF v_item.variant_id IS NOT NULL THEN
        UPDATE product_variants SET quantity = quantity + v_item.quantity WHERE id = v_item.variant_id;
      ELSIF v_item.product_id IS NOT NULL AND (v_item.size IS NOT NULL OR v_item.color IS NOT NULL) THEN
        -- A variação foi recriada por uma edição do produto: acha pela etiqueta.
        UPDATE product_variants SET quantity = quantity + v_item.quantity
         WHERE id = (SELECT id FROM product_variants
                      WHERE product_id = v_item.product_id
                        AND size IS NOT DISTINCT FROM v_item.size
                        AND color IS NOT DISTINCT FROM v_item.color
                      ORDER BY created_at
                      LIMIT 1);
      END IF;
    END LOOP;

    UPDATE store_orders SET status = 'cancelado', updated_at = now() WHERE id = p_order_id;

  ELSE
    RAISE EXCEPTION 'Situação inválida: %', p_status;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.store_update_order(uuid, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.store_update_order(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.store_update_order(uuid, text, text) TO authenticated;
