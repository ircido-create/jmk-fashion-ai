CREATE TABLE public.customer_merge_ignored (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_a_id UUID NOT NULL,
  customer_b_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_merge_ignored_pair_unique UNIQUE (customer_a_id, customer_b_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_merge_ignored TO authenticated;
GRANT ALL ON public.customer_merge_ignored TO service_role;

ALTER TABLE public.customer_merge_ignored ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read merge ignored" ON public.customer_merge_ignored FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert merge ignored" ON public.customer_merge_ignored FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth delete merge ignored" ON public.customer_merge_ignored FOR DELETE TO authenticated USING (true);