# Plan - Fix Dunning RPC Ambiguity

The manual billing (cobranca manual) is failing because there are two versions of the `get_overdue_receivables_to_dunning` function in the database with different numbers of arguments. When the Edge Function calls it, PostgreSQL cannot decide which one to use, resulting in an error. I will remove the older version and ensure the newer one is the only one active.

## Proposed Changes

### Database (Supabase)
- Drop the ambiguous RPC functions.
- Re-create a single, definitive version of `get_overdue_receivables_to_dunning` that includes the `p_max_dias_vencido` parameter (defaulting to 60) and uses the correct time zone logic.

### Backend (Edge Functions)
- Update `dunning-cron` to explicitly pass all arguments to the RPC to avoid any remaining ambiguity.

## Technical Details

### SQL Migration
```sql
-- Drop both versions to clear the ambiguity
DROP FUNCTION IF EXISTS public.get_overdue_receivables_to_dunning(date, integer);
DROP FUNCTION IF EXISTS public.get_overdue_receivables_to_dunning(date, integer, integer);

-- Create the consolidated version
CREATE OR REPLACE FUNCTION public.get_overdue_receivables_to_dunning(
  p_today date DEFAULT (timezone('America/Sao_Paulo'::text, now()))::date,
  p_limit integer DEFAULT 50,
  p_max_dias_vencido integer DEFAULT 60
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
```
