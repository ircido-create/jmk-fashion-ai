-- Peça com foto só na variação também entra na vitrine.
--
-- O "Vestido Tubo Elaine" foi marcado para a loja, tinha preço, estoque e
-- foto — mas a foto estava na variação, e não em products.image_url. A regra
-- antiga exigia a capa no produto, então a peça simplesmente não aparecia e
-- ninguém tinha como descobrir por quê. Boa parte do cadastro é assim: a foto
-- chega pela variação (romaneio, etiqueta, busca por fornecedor).
--
-- Agora a capa é a primeira que existir: a do produto, a primeira da galeria
-- ou a de uma variação com estoque.
CREATE OR REPLACE FUNCTION public.store_catalog()
RETURNS TABLE (
  id uuid, name text, description text, price numeric, image_url text,
  images text[], garment_type text, created_at timestamptz, variants jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.description, p.price,
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
