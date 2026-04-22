
-- Colunas de mídia em whatsapp_messages
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_type text, -- 'image' | 'audio' | 'document' | 'video'
  ADD COLUMN IF NOT EXISTS media_mime text,
  ADD COLUMN IF NOT EXISTS media_filename text;

-- Bucket privado para mídias do WhatsApp
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', false)
ON CONFLICT (id) DO NOTHING;

-- Policies storage: admin/vendedor podem ler e gravar
DROP POLICY IF EXISTS "Staff read whatsapp media" ON storage.objects;
CREATE POLICY "Staff read whatsapp media"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'vendedor'::app_role))
);

DROP POLICY IF EXISTS "Staff upload whatsapp media" ON storage.objects;
CREATE POLICY "Staff upload whatsapp media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'whatsapp-media'
  AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'vendedor'::app_role))
);

DROP POLICY IF EXISTS "Staff update whatsapp media" ON storage.objects;
CREATE POLICY "Staff update whatsapp media"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'vendedor'::app_role))
);

DROP POLICY IF EXISTS "Admin delete whatsapp media" ON storage.objects;
CREATE POLICY "Admin delete whatsapp media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND public.has_role(auth.uid(), 'admin'::app_role)
);
