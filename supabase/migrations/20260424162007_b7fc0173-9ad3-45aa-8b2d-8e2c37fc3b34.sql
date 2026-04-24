-- Tabela de vozes clonadas no ElevenLabs
CREATE TABLE public.voice_clones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  voice_id TEXT NOT NULL UNIQUE,
  description TEXT,
  sample_storage_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garante apenas uma voz ativa
CREATE UNIQUE INDEX voice_clones_only_one_active
  ON public.voice_clones (is_active)
  WHERE is_active = true;

ALTER TABLE public.voice_clones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_clones_select_authenticated"
  ON public.voice_clones FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "voice_clones_admin_insert"
  ON public.voice_clones FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "voice_clones_admin_update"
  ON public.voice_clones FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "voice_clones_admin_delete"
  ON public.voice_clones FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER voice_clones_set_updated_at
  BEFORE UPDATE ON public.voice_clones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Bucket para amostras de áudio (acesso público para preview)
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-samples', 'voice-samples', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "voice_samples_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'voice-samples');

CREATE POLICY "voice_samples_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'voice-samples' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "voice_samples_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'voice-samples' AND public.has_role(auth.uid(), 'admin'));