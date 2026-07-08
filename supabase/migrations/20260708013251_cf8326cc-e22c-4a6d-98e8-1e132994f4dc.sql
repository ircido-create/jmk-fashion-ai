
ALTER TABLE public.payment_proofs
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS bucket text NOT NULL DEFAULT 'payment-proofs',
  ADD COLUMN IF NOT EXISTS ai_is_payment_proof boolean,
  ADD COLUMN IF NOT EXISTS ai_amount numeric,
  ADD COLUMN IF NOT EXISTS ai_payer_name text,
  ADD COLUMN IF NOT EXISTS ai_bank text,
  ADD COLUMN IF NOT EXISTS ai_transaction_id text,
  ADD COLUMN IF NOT EXISTS ai_summary text;

-- Permite que a whatsapp_message_id (uuid) seja preenchida via service_role no webhook.
-- payment_proofs já tem RLS: staff insert/select, admin delete. Mantemos igual.
