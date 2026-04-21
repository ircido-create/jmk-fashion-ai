ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier text;
CREATE INDEX IF NOT EXISTS idx_products_supplier ON public.products(supplier);