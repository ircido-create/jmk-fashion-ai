CREATE OR REPLACE FUNCTION public.get_overdue_receivables_to_dunning(
  p_today date DEFAULT (timezone('America/Sao_Paulo'::text, now()))::date, 
  p_limit integer DEFAULT 50, 
  p_max_dias_vencido integer DEFAULT 180
)
 RETURNS TABLE(id uuid, amount numeric, due_date date, description text, customer_id uuid, customers jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;