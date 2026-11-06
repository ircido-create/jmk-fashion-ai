-- Preco "De R$ ... por R$ ..." na loja virtual.
--
-- Ate agora a vitrine so mostrava um numero. Na Black Friday a oferta precisa
-- aparecer: a cliente ve o preco cheio riscado e o preco que vai pagar.
--
-- O preco cobrado continua sendo products.price — e ele que store_place_order
-- usa. A coluna nova e so o preco "de", o valor antes do desconto; nada no
-- financeiro, no PDV ou na cobranca olha para ela.
--
-- Regra da vitrine: o "de" so aparece quando e maior que o preco de venda.
-- Um "de" igual ou menor seria propaganda enganosa, entao a funcao devolve
-- NULL nesse caso e a loja simplesmente nao mostra nada.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS compare_at_price numeric;

COMMENT ON COLUMN public.products.compare_at_price IS
  'Preco "de" (antes do desconto) exibido riscado na loja virtual. Nao e cobrado: quem cobra e price.';

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_compare_at_price_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_compare_at_price_check
      CHECK (compare_at_price IS NULL OR compare_at_price >= 0);
  END IF;
END
$check$;

-- A funcao ganha uma coluna, e trocar o tipo de retorno exige derrubar a
-- anterior; o DROP e o CREATE seguem juntos, na mesma migracao.
DROP FUNCTION IF EXISTS public.store_catalog();

CREATE FUNCTION public.store_catalog()
RETURNS TABLE (
  id uuid, name text, description text, price numeric, compare_at_price numeric,
  image_url text, images text[], garment_type text, created_at timestamptz, variants jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.description, p.price,
         -- so vale como oferta se o "de" for maior que o que se paga
         CASE WHEN p.compare_at_price > p.price THEN p.compare_at_price END AS compare_at_price,
         COALESCE(p.image_url, p.images[1], cv.image_url) AS image_url,
         p.images, p.garment_type, p.created_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', v.id, 'size', v.size, 'color', v.color,
                    'quantity', LEAST(v.quantity, 10), 'image_url', v.image_url)
                  ORDER BY v.size NULLS LAST, v.color NULLS LAST)
             FROM product_variants v
            WHERE v.product_id = p.id AND v.quantity > 0
         ), '[]'::jsonb)
    FROM products p
    LEFT JOIN LATERAL (
      SELECT v.image_url
        FROM product_variants v
       WHERE v.product_id = p.id AND v.image_url IS NOT NULL AND v.quantity > 0
       ORDER BY v.size NULLS LAST, v.color NULLS LAST
       LIMIT 1
    ) cv ON true
   WHERE p.active AND NOT p.is_draft AND p.store_visible AND p.price > 0
     AND COALESCE(p.image_url, p.images[1], cv.image_url) IS NOT NULL
     AND (EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.quantity > 0)
          OR NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id))
   ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.store_catalog() FROM public;
GRANT EXECUTE ON FUNCTION public.store_catalog() TO anon, authenticated;
