
CREATE TABLE public.status_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  image_url text,
  caption text,
  posted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_status_posts_expires ON public.status_posts(expires_at);
CREATE INDEX idx_status_posts_product ON public.status_posts(product_id);

ALTER TABLE public.status_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view status_posts" ON public.status_posts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Staff insert status_posts" ON public.status_posts
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Staff update status_posts" ON public.status_posts
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Admins delete status_posts" ON public.status_posts
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
