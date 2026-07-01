CREATE TABLE public.imported_romaneios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_hash TEXT NOT NULL UNIQUE,
  supplier TEXT,
  total NUMERIC,
  items_count INTEGER,
  storage_path TEXT,
  filename TEXT,
  imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_imported_romaneios_supplier_total ON public.imported_romaneios (supplier, total, items_count);

GRANT SELECT, INSERT ON public.imported_romaneios TO authenticated;
GRANT ALL ON public.imported_romaneios TO service_role;

ALTER TABLE public.imported_romaneios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read imported_romaneios" ON public.imported_romaneios
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert imported_romaneios" ON public.imported_romaneios
  FOR INSERT TO authenticated WITH CHECK (true);