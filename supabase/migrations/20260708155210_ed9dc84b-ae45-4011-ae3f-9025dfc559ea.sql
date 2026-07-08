CREATE TABLE public.status_reaction_sent (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  target_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (phone, target_key)
);
GRANT SELECT, INSERT ON public.status_reaction_sent TO authenticated;
GRANT ALL ON public.status_reaction_sent TO service_role;
ALTER TABLE public.status_reaction_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read" ON public.status_reaction_sent FOR SELECT TO authenticated USING (true);