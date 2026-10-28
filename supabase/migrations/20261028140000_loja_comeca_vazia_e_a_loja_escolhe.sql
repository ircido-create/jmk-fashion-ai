-- A vitrine passa a ser montada peça por peça.
--
-- A migração anterior deixou todo o cadastro marcado para a loja (era o estado
-- de antes, quando tudo aparecia automaticamente). A loja decidiu o contrário:
-- começar com a vitrine vazia e marcar só as peças que quiser vender on-line.
--
-- Depois disto a loja virtual fica sem produtos até alguém marcar "Mostrar na
-- loja virtual" no Estoque. Nada é apagado: as peças seguem normais no PDV.
UPDATE public.products SET store_visible = false WHERE store_visible;

-- Peça nova também nasce fora da vitrine.
ALTER TABLE public.products ALTER COLUMN store_visible SET DEFAULT false;

COMMENT ON COLUMN public.products.store_visible IS
  'Peça escolhida para a loja virtual. Padrão: fora da vitrine; marcada no Estoque, aparece em /loja quando tiver foto, preço e estoque.';
