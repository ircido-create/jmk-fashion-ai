
-- Remover importações do romaneio de 06-07/07/2026
-- Apagar variantes de produtos criados nessa importação
DELETE FROM public.product_variants
WHERE created_at::date >= '2026-07-06'
  AND product_id IN (SELECT id FROM public.products WHERE created_at::date >= '2026-07-06');

-- Apagar variantes soltas criadas nessa data
DELETE FROM public.product_variants WHERE created_at::date >= '2026-07-06';

-- Apagar produtos criados nessa data (sem itens de venda vinculados)
DELETE FROM public.products
WHERE created_at::date >= '2026-07-06'
  AND id NOT IN (SELECT DISTINCT product_id FROM public.sale_items WHERE product_id IS NOT NULL);

-- Apagar registros do romaneio importado
DELETE FROM public.imported_romaneios WHERE created_at::date >= '2026-07-06';
