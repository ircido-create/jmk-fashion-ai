-- Produto com mais de uma foto.
--
-- Até aqui cada peça tinha uma foto só (products.image_url) e o resto da
-- galeria vinha das variações. Para vender on-line a loja precisa mostrar a
-- peça de vários ângulos sem ter de inventar variação para isso.
--
-- images guarda a galeria inteira, na ordem em que aparece; a primeira é a
-- capa. image_url continua existindo e apontando para a capa, porque PDV,
-- cupom, pré-venda e WhatsApp leem esse campo.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.products.images IS
  'Galeria da peça, em ordem. A primeira é a capa e espelha image_url.';

-- Quem já tinha foto começa com ela na galeria.
UPDATE public.products
   SET images = ARRAY[image_url]
 WHERE image_url IS NOT NULL AND cardinality(images) = 0;

-- A loja passa a receber a galeria junto com o resto do catálogo.
DROP FUNCTION IF EXISTS public.store_catalog();
CREATE FUNCTION public.store_catalog()
RETURNS TABLE (
  id uuid, name text, description text, price numeric, image_url text,
  images text[], garment_type text, created_at timestamptz, variants jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.description, p.price, p.image_url, p.images, p.garment_type, p.created_at,
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
