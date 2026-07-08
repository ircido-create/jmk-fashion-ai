
ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS ai_paused boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.ai_blocked_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_blocked_contacts TO authenticated;
GRANT ALL ON public.ai_blocked_contacts TO service_role;

ALTER TABLE public.ai_blocked_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ai_blocked_contacts"
  ON public.ai_blocked_contacts
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Authenticated read ai_blocked_contacts"
  ON public.ai_blocked_contacts
  FOR SELECT
  TO authenticated
  USING (true);
