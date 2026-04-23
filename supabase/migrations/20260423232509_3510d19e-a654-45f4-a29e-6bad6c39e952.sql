-- Add CPF/CNPJ field to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tax_id text;

-- Partial unique index: same CPF cannot be registered twice (but multiple NULLs allowed)
CREATE UNIQUE INDEX IF NOT EXISTS customers_tax_id_unique 
  ON public.customers (tax_id) 
  WHERE tax_id IS NOT NULL;

-- Index for lookup
CREATE INDEX IF NOT EXISTS customers_tax_id_idx ON public.customers (tax_id);