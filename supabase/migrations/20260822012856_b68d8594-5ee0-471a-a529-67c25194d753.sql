CREATE TABLE IF NOT EXISTS public.dunning_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  origem text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'executando',
  total integer,
  enviadas integer,
  falhadas integer,
  erro text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

GRANT SELECT ON public.dunning_runs TO authenticated;
GRANT ALL ON public.dunning_runs TO service_role;

ALTER TABLE public.dunning_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados podem ver rodadas de cobranca"
ON public.dunning_runs FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS dunning_runs_started_at_idx ON public.dunning_runs (started_at DESC);

CREATE OR REPLACE FUNCTION public.get_overdue_receivables_to_dunning(p_today date, p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  customer_id uuid,
  amount numeric,
  due_date date,
  description text,
  customers jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id,
         r.customer_id,
         r.amount,
         r.due_date,
         r.description,
         jsonb_build_object('name', c.name, 'phone', c.phone) AS customers
    FROM public.accounts_receivable r
    JOIN public.customers c ON c.id = r.customer_id
   WHERE r.status = 'vencido'
     AND COALESCE(c.phone, '') <> ''
     AND r.due_date < p_today
     AND (p_today - r.due_date) <= 60
     AND NOT EXISTS (
       SELECT 1 FROM public.dunning_logs dl
        WHERE dl.receivable_id = r.id
          AND dl.sent_at >= p_today::timestamptz
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.ai_blocked_contacts b
        WHERE regexp_replace(COALESCE(b.phone, ''), '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g')
     )
   ORDER BY r.due_date ASC
   LIMIT COALESCE(p_limit, 50);
$$;

REVOKE ALL ON FUNCTION public.get_overdue_receivables_to_dunning(date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_overdue_receivables_to_dunning(date, integer) TO service_role;