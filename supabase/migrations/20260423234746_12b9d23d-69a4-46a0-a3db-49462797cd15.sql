
-- Tabela de comprovantes de pagamento
CREATE TABLE public.payment_proofs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID,
  storage_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  file_size BIGINT,
  description TEXT,
  payment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view payment_proofs" ON public.payment_proofs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Staff insert payment_proofs" ON public.payment_proofs
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Admins delete payment_proofs" ON public.payment_proofs
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Tabela de vínculo entre contas a receber e comprovantes
CREATE TABLE public.receivable_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  receivable_id UUID NOT NULL REFERENCES public.accounts_receivable(id) ON DELETE CASCADE,
  proof_id UUID NOT NULL REFERENCES public.payment_proofs(id) ON DELETE CASCADE,
  amount_paid NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX idx_receivable_payments_receivable ON public.receivable_payments(receivable_id);
CREATE INDEX idx_receivable_payments_proof ON public.receivable_payments(proof_id);

ALTER TABLE public.receivable_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view receivable_payments" ON public.receivable_payments
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Staff insert receivable_payments" ON public.receivable_payments
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role));

CREATE POLICY "Admins delete receivable_payments" ON public.receivable_payments
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Bucket privado para comprovantes
INSERT INTO storage.buckets (id, name, public) VALUES ('payment-proofs', 'payment-proofs', false);

CREATE POLICY "Staff read payment-proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role)));

CREATE POLICY "Staff upload payment-proofs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'vendedor'::app_role)));

CREATE POLICY "Admins delete payment-proofs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'payment-proofs' AND has_role(auth.uid(), 'admin'::app_role));
