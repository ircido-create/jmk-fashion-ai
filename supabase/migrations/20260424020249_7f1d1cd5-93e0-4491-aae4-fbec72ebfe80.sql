ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS nickname TEXT;
CREATE INDEX IF NOT EXISTS customers_nickname_idx ON public.customers (lower(nickname));