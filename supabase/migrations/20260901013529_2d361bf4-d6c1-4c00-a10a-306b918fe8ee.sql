ALTER TABLE public.accounts_receivable
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_receivable_sale_id
  ON public.accounts_receivable (sale_id);