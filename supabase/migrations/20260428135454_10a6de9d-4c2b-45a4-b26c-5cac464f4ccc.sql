ALTER TABLE public.sales 
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS installments integer DEFAULT 1;
