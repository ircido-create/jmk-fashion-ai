
-- Enum de status
CREATE TYPE public.pre_sale_status AS ENUM (
  'aguardando_aprovacao',
  'aguardando_compra',
  'em_compra',
  'recebido',
  'pronto_entrega',
  'finalizado',
  'cancelado'
);

-- Coluna is_draft em products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;

-- Tabela pre_sales
CREATE TABLE public.pre_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.pre_sale_status NOT NULL DEFAULT 'aguardando_aprovacao',
  total numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  notes text,
  whatsapp_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tabela pre_sale_items
CREATE TABLE public.pre_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_sale_id uuid NOT NULL REFERENCES public.pre_sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  supplier text,
  code text,
  description text NOT NULL,
  color text,
  size text,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  photo_url text,
  raw_ocr jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pre_sales_customer ON public.pre_sales(customer_id);
CREATE INDEX idx_pre_sales_status ON public.pre_sales(status);
CREATE INDEX idx_pre_sale_items_presale ON public.pre_sale_items(pre_sale_id);

-- RLS pre_sales
ALTER TABLE public.pre_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view pre_sales" ON public.pre_sales FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'vendedor'));
CREATE POLICY "Staff insert pre_sales" ON public.pre_sales FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'vendedor'));
CREATE POLICY "Staff update pre_sales" ON public.pre_sales FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'vendedor'));
CREATE POLICY "Admins delete pre_sales" ON public.pre_sales FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- RLS pre_sale_items
ALTER TABLE public.pre_sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view pre_sale_items" ON public.pre_sale_items FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'vendedor'));
CREATE POLICY "Staff insert pre_sale_items" ON public.pre_sale_items FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'vendedor'));
CREATE POLICY "Staff update pre_sale_items" ON public.pre_sale_items FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'vendedor'));
CREATE POLICY "Admins delete pre_sale_items" ON public.pre_sale_items FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- Trigger updated_at
CREATE TRIGGER pre_sales_set_updated_at
  BEFORE UPDATE ON public.pre_sales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('pre-sale-labels', 'pre-sale-labels', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Staff read pre-sale labels" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pre-sale-labels' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'vendedor')));
CREATE POLICY "Staff upload pre-sale labels" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pre-sale-labels' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'vendedor')));
CREATE POLICY "Staff delete pre-sale labels" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pre-sale-labels' AND has_role(auth.uid(), 'admin'));
