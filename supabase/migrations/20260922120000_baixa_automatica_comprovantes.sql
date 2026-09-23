-- Baixa automática de comprovantes recebidos pelo WhatsApp.
--
-- Regra: quando a Mônica salva um comprovante, se o valor lido for IGUAL ao de
-- uma parcela em aberto da cliente, essa parcela é quitada e vinculada ao
-- comprovante. Qualquer outra situação (valor diferente, cliente não
-- identificada, comprovante repetido) fica "pendente" para o administrador dar
-- a baixa manualmente. Todos os comprovantes continuam aparecendo no painel.
--
-- Roda como trigger no banco, então não depende de republicar a edge function.

ALTER TABLE public.payment_proofs
  ADD COLUMN IF NOT EXISTS settlement_status text,
  ADD COLUMN IF NOT EXISTS settlement_note text,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

ALTER TABLE public.payment_proofs
  DROP CONSTRAINT IF EXISTS payment_proofs_settlement_status_check;
ALTER TABLE public.payment_proofs
  ADD CONSTRAINT payment_proofs_settlement_status_check
  CHECK (settlement_status IS NULL OR settlement_status IN ('auto', 'manual', 'pendente', 'ignorado'));

CREATE INDEX IF NOT EXISTS idx_payment_proofs_settlement_status ON public.payment_proofs(settlement_status);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_txid ON public.payment_proofs(lower(regexp_replace(ai_transaction_id, '\s', '', 'g')));

-- Comprovantes antigos que já têm pagamento vinculado contam como baixa manual.
-- Os demais antigos ficam sem status (anteriores à baixa automática).
UPDATE public.payment_proofs p
   SET settlement_status = 'manual',
       settled_at = COALESCE(p.settled_at, p.created_at)
 WHERE p.settlement_status IS NULL
   AND EXISTS (SELECT 1 FROM public.receivable_payments rp WHERE rp.proof_id = p.id);

-- ---------------------------------------------------------------------------
-- Identifica a cliente de um comprovante: primeiro pela conversa do WhatsApp,
-- depois pelo telefone (mesma regra do webhook). Só devolve se houver UMA
-- cliente possível.
CREATE OR REPLACE FUNCTION public.resolve_payment_proof_customer(p_whatsapp_message_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_conv_customer uuid;
  v_phone text;
  v_variants text[];
  v_ids uuid[];
BEGIN
  IF p_whatsapp_message_id IS NULL THEN RETURN NULL; END IF;

  SELECT c.customer_id, regexp_replace(COALESCE(c.customer_phone, ''), '\D', '', 'g')
    INTO v_conv_customer, v_phone
    FROM public.whatsapp_messages m
    JOIN public.whatsapp_conversations c ON c.id = m.conversation_id
   WHERE m.id = p_whatsapp_message_id;

  IF v_conv_customer IS NOT NULL THEN RETURN v_conv_customer; END IF;
  IF v_phone IS NULL OR length(v_phone) < 10 THEN RETURN NULL; END IF;

  v_variants := ARRAY[v_phone];
  IF v_phone LIKE '55%' THEN v_variants := v_variants || substr(v_phone, 3);
  ELSE v_variants := v_variants || ('55' || v_phone);
  END IF;

  SELECT array_agg(DISTINCT x.id) INTO v_ids
    FROM public.customers x
    CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(x.phone, ''), '\D', '', 'g') AS d) n
    CROSS JOIN LATERAL unnest(v_variants) v
   WHERE length(n.d) >= 10
     AND (n.d = v OR n.d LIKE '%' || v OR v LIKE '%' || n.d);

  IF v_ids IS NOT NULL AND array_length(v_ids, 1) = 1 THEN RETURN v_ids[1]; END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_settle_payment_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_customer uuid := NEW.customer_id;
  v_amount numeric := round(NEW.ai_amount, 2);
  v_txid text := NULLIF(lower(regexp_replace(COALESCE(NEW.ai_transaction_id, ''), '\s', '', 'g')), '');
  v_receivable record;
  v_open_count integer;
  v_open_values text;
  v_note text;
BEGIN
  IF NEW.source <> 'monica' OR NEW.ai_is_payment_proof IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  BEGIN
    IF v_customer IS NULL THEN
      v_customer := public.resolve_payment_proof_customer(NEW.whatsapp_message_id);
    END IF;

    IF v_customer IS NULL THEN
      v_note := 'Cliente não identificada pelo telefone';
    ELSIF v_amount IS NULL OR v_amount <= 0 THEN
      v_note := 'Valor não identificado no comprovante';
    ELSIF v_txid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.payment_proofs o
       WHERE o.id <> NEW.id
         AND lower(regexp_replace(o.ai_transaction_id, '\s', '', 'g')) = v_txid
    ) THEN
      v_note := 'Comprovante repetido (mesmo ID de transação já recebido)';
    ELSIF v_txid IS NULL AND EXISTS (
      SELECT 1 FROM public.payment_proofs o
       WHERE o.id <> NEW.id
         AND o.customer_id = v_customer
         AND round(o.ai_amount, 2) = v_amount
         AND o.created_at > NEW.created_at - interval '24 hours'
    ) THEN
      v_note := 'Possível comprovante repetido (mesmo valor nas últimas 24h, sem ID de transação)';
    END IF;

    IF v_note IS NULL THEN
      SELECT ar.id, ar.amount, ar.description, ar.due_date
        INTO v_receivable
        FROM public.accounts_receivable ar
       WHERE ar.customer_id = v_customer
         AND ar.status IN ('pendente', 'vencido')
         AND round(ar.amount, 2) = v_amount
       ORDER BY ar.due_date, ar.created_at
       LIMIT 1
       FOR UPDATE;

      IF v_receivable.id IS NULL THEN
        SELECT count(*), string_agg(to_char(ar.amount, 'FM999G990D00'), ', ' ORDER BY ar.due_date)
          INTO v_open_count, v_open_values
          FROM public.accounts_receivable ar
         WHERE ar.customer_id = v_customer
           AND ar.status IN ('pendente', 'vencido');
        IF v_open_count = 0 THEN
          v_note := 'Cliente sem parcelas em aberto';
        ELSE
          v_note := 'Valor diferente das parcelas em aberto (' || left(v_open_values, 200) || ')';
        END IF;
      END IF;
    END IF;

    IF v_note IS NOT NULL THEN
      UPDATE public.payment_proofs
         SET customer_id = v_customer,
             settlement_status = 'pendente',
             settlement_note = v_note
       WHERE id = NEW.id;
      RETURN NULL;
    END IF;

    UPDATE public.accounts_receivable
       SET status = 'pago', paid_at = now()
     WHERE id = v_receivable.id;

    INSERT INTO public.receivable_payments (receivable_id, proof_id, amount_paid)
    VALUES (v_receivable.id, NEW.id, v_receivable.amount);

    UPDATE public.payment_proofs
       SET customer_id = v_customer,
           settlement_status = 'auto',
           settlement_note = 'Parcela ' || to_char(v_receivable.due_date, 'DD/MM/YYYY')
                             || COALESCE(' — ' || v_receivable.description, '') || ' quitada automaticamente',
           settled_at = now()
     WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    -- Nunca perder o comprovante por causa da baixa automática.
    UPDATE public.payment_proofs
       SET customer_id = COALESCE(customer_id, v_customer),
           settlement_status = 'pendente',
           settlement_note = 'Erro na baixa automática: ' || left(SQLERRM, 200)
     WHERE id = NEW.id;
  END;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_settle_payment_proof ON public.payment_proofs;
CREATE TRIGGER trg_auto_settle_payment_proof
  AFTER INSERT ON public.payment_proofs
  FOR EACH ROW EXECUTE FUNCTION public.auto_settle_payment_proof();

-- ---------------------------------------------------------------------------
-- Qualquer vínculo criado à mão (Contas a Receber ou tela de Comprovantes)
-- marca o comprovante como baixado manualmente e preenche a cliente se faltar.
-- A baixa automática sobrescreve para 'auto' logo depois, na mesma transação.
CREATE OR REPLACE FUNCTION public.mark_payment_proof_settled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.payment_proofs p
     SET settlement_status = 'manual',
         settlement_note = NULL,
         settled_at = now(),
         customer_id = COALESCE(p.customer_id, (SELECT ar.customer_id FROM public.accounts_receivable ar WHERE ar.id = NEW.receivable_id))
   WHERE p.id = NEW.proof_id
     AND (p.settlement_status IS NULL OR p.settlement_status IN ('pendente', 'ignorado'));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_payment_proof_settled ON public.receivable_payments;
CREATE TRIGGER trg_mark_payment_proof_settled
  AFTER INSERT ON public.receivable_payments
  FOR EACH ROW EXECUTE FUNCTION public.mark_payment_proof_settled();

-- ---------------------------------------------------------------------------
-- Admin descarta um comprovante pendente (ex.: repetido) ou reabre um descartado.
CREATE OR REPLACE FUNCTION public.set_payment_proof_pending_status(p_proof_id uuid, p_ignore boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Somente administradores podem alterar o status do comprovante';
  END IF;

  UPDATE public.payment_proofs
     SET settlement_status = CASE WHEN p_ignore THEN 'ignorado' ELSE 'pendente' END,
         settlement_note = COALESCE(NULLIF(trim(p_note), ''), settlement_note),
         settled_at = CASE WHEN p_ignore THEN now() ELSE NULL END
   WHERE id = p_proof_id
     AND settlement_status IN ('pendente', 'ignorado');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Só é possível descartar ou reabrir comprovantes sem baixa';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_payment_proof_pending_status(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_payment_proof_pending_status(uuid, boolean, text) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_payment_proof_customer(uuid) FROM public, anon, authenticated;
