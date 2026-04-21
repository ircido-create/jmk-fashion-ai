
-- Tabela para mapear fornecedores aos seus sites oficiais
CREATE TABLE public.supplier_sites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_name TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view supplier_sites"
  ON public.supplier_sites FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Staff insert supplier_sites"
  ON public.supplier_sites FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Staff update supplier_sites"
  ON public.supplier_sites FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Admins delete supplier_sites"
  ON public.supplier_sites FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_supplier_sites_updated_at
  BEFORE UPDATE ON public.supplier_sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Coluna de imagem principal do produto
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT;
