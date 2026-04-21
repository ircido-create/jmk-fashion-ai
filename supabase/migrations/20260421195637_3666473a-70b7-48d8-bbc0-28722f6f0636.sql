-- Bucket privado para PDFs de romaneios
INSERT INTO storage.buckets (id, name, public)
VALUES ('romaneios', 'romaneios', false)
ON CONFLICT (id) DO NOTHING;

-- Staff pode ler arquivos no bucket
CREATE POLICY "Staff view romaneios"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'romaneios'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'vendedor'))
);

-- Staff pode fazer upload
CREATE POLICY "Staff upload romaneios"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'romaneios'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'vendedor'))
);

-- Staff pode deletar (limpeza)
CREATE POLICY "Staff delete romaneios"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'romaneios'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'vendedor'))
);