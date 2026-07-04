CREATE INDEX IF NOT EXISTS idx_accounts_receivable_customer_due
  ON public.accounts_receivable (customer_id, due_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_status_due
  ON public.accounts_receivable (status, due_date);
CREATE INDEX IF NOT EXISTS idx_accounts_payable_status_due
  ON public.accounts_payable (status, due_date);
CREATE INDEX IF NOT EXISTS idx_sales_date
  ON public.sales (sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer
  ON public.sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON public.product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_customers_name_lower
  ON public.customers (lower(name));