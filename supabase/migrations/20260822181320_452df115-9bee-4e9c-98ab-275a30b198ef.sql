CREATE OR REPLACE FUNCTION public.get_overdue_receivables_to_dunning(
  p_today DATE DEFAULT timezone('America/Sao_Paulo', now())::date,
  p_limit INTEGER DEFAULT 50,
  p_max_dias_vencido INTEGER DEFAULT 60
)
RETURNS TABLE (
  id UUID,
  amount NUMERIC,
  due_date DATE,
  description TEXT,
  customer_id UUID,
  customers JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ar.id,
    ar.amount,
    ar.due_date,
    ar.description,
    ar.customer_id,
    jsonb_build_object('name', c.name, 'phone', c.phone) AS customers
  FROM public.accounts_receivable ar
  JOIN public.customers c ON c.id = ar.customer_id
  WHERE ar.status = 'vencido'
    AND c.phone IS NOT NULL
    AND btrim(c.phone) <> ''
    AND ar.due_date < p_today
    AND ar.due_date >= p_today - p_max_dias_vencido
    AND NOT EXISTS (
      SELECT 1 FROM public.dunning_logs dl
       WHERE dl.receivable_id = ar.id
         AND dl.sent_at >= p_today::timestamptz
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_blocked_contacts b
       WHERE regexp_replace(b.phone, '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g')
    )
  ORDER BY ar.due_date ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_overdue_receivables_to_dunning(DATE, INTEGER, INTEGER) TO service_role;