-- Baixa de parcelas numa única transação.
--
-- Antes, a tela quitava/reduzia as parcelas e só depois gravava o comprovante
-- e o vínculo (receivable_payments), em chamadas separadas. Se algo falhasse
-- no meio, a parcela ficava paga sem registro de quem pagou — e o estorno
-- (reverse_payment_proof) depende desse registro. Em 23/09/2026 havia 9
-- parcelas pagas sem nenhum vínculo (R$ 1.600, jun–ago).
--
-- Agora a tela calcula o que fazer (reconcileManualPayment / reconcile) e
-- manda tudo para esta função: ou grava parcelas + comprovante + vínculos, ou
-- não grava nada. Ela também recusa a baixa se a parcela mudou desde que a
-- tela foi carregada (outra pessoa deu baixa, valor editado, baixa automática).

CREATE OR REPLACE FUNCTION public.apply_receivable_payment(
  p_actions jsonb,
  p_paid_at timestamptz,
  p_proof_id uuid DEFAULT NULL,
  p_proof jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_proof_id uuid := p_proof_id;
  v_action jsonb;
  v_id uuid;
  v_kind text;
  v_paid numeric;
  v_expected numeric;
  v_row record;
  v_settled integer := 0;
  v_reduced integer := 0;
  v_total numeric := 0;
  v_label text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'vendedor'::public.app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para dar baixa';
  END IF;

  IF p_actions IS NULL OR jsonb_typeof(p_actions) <> 'array' OR jsonb_array_length(p_actions) = 0 THEN
    RAISE EXCEPTION 'Nenhuma parcela para baixar';
  END IF;
  IF p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Informe a data do recebimento';
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(p_actions) a)
     <> (SELECT count(DISTINCT a->>'receivable_id') FROM jsonb_array_elements(p_actions) a) THEN
    RAISE EXCEPTION 'A mesma parcela aparece duas vezes na baixa';
  END IF;

  -- Comprovante: usa o informado ou cria um (o registro do pagamento é obrigatório).
  IF v_proof_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.payment_proofs WHERE id = v_proof_id) THEN
      RAISE EXCEPTION 'Comprovante não encontrado';
    END IF;
  ELSE
    INSERT INTO public.payment_proofs (
      storage_path, bucket, original_filename, mime_type, file_size,
      description, payment_date, customer_id, source, created_by
    ) VALUES (
      COALESCE(p_proof->>'storage_path', ''),
      COALESCE(p_proof->>'bucket', 'payment-proofs'),
      p_proof->>'original_filename',
      p_proof->>'mime_type',
      NULLIF(p_proof->>'file_size', '')::bigint,
      p_proof->>'description',
      p_paid_at,
      NULLIF(p_proof->>'customer_id', '')::uuid,
      'manual',
      auth.uid()
    )
    RETURNING id INTO v_proof_id;
  END IF;

  -- Trava as parcelas em ordem fixa para duas baixas simultâneas não se cruzarem.
  PERFORM 1 FROM public.accounts_receivable
   WHERE id IN (SELECT (a->>'receivable_id')::uuid FROM jsonb_array_elements(p_actions) a)
   ORDER BY id
   FOR UPDATE;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
    v_id := (v_action->>'receivable_id')::uuid;
    v_kind := v_action->>'kind';
    v_paid := round((v_action->>'amount_paid')::numeric, 2);
    v_expected := round((v_action->>'expected_amount')::numeric, 2);

    SELECT id, amount, status, due_date, description INTO v_row
      FROM public.accounts_receivable WHERE id = v_id;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Parcela não encontrada — recarregue a tela';
    END IF;
    v_label := to_char(v_row.due_date, 'DD/MM/YYYY') || COALESCE(' (' || v_row.description || ')', '');

    IF v_row.status NOT IN ('pendente', 'vencido') THEN
      RAISE EXCEPTION 'A parcela % já está %. Recarregue a tela antes de dar baixa.', v_label, v_row.status;
    END IF;
    IF v_expected IS NULL OR round(v_row.amount, 2) <> v_expected THEN
      RAISE EXCEPTION 'O valor da parcela % mudou (agora R$ %). Recarregue a tela antes de dar baixa.',
        v_label, replace(to_char(v_row.amount, 'FM9999999990.00'), '.', ',');
    END IF;
    IF v_paid IS NULL OR v_paid <= 0 THEN
      RAISE EXCEPTION 'Valor inválido para a parcela %', v_label;
    END IF;

    IF v_kind = 'settle' THEN
      IF v_paid <> round(v_row.amount, 2) THEN
        RAISE EXCEPTION 'Quitação da parcela % com valor diferente do saldo', v_label;
      END IF;
      UPDATE public.accounts_receivable
         SET status = 'pago', paid_at = p_paid_at
       WHERE id = v_id;
      v_settled := v_settled + 1;
    ELSIF v_kind = 'reduce' THEN
      IF v_paid >= round(v_row.amount, 2) THEN
        RAISE EXCEPTION 'Redução da parcela % maior ou igual ao saldo', v_label;
      END IF;
      UPDATE public.accounts_receivable
         SET amount = round(v_row.amount - v_paid, 2)
       WHERE id = v_id;
      v_reduced := v_reduced + 1;
    ELSE
      RAISE EXCEPTION 'Tipo de baixa inválido: %', COALESCE(v_kind, '(vazio)');
    END IF;

    INSERT INTO public.receivable_payments (receivable_id, proof_id, amount_paid)
    VALUES (v_id, v_proof_id, v_paid);
    v_total := v_total + v_paid;
  END LOOP;

  RETURN jsonb_build_object(
    'proof_id', v_proof_id,
    'settled', v_settled,
    'reduced', v_reduced,
    'paid_total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_receivable_payment(jsonb, timestamptz, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_receivable_payment(jsonb, timestamptz, uuid, jsonb) TO authenticated;

-- Valores no aviso da baixa automática em formato brasileiro (70,00 em vez de 70.00).
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
        SELECT count(*), string_agg(replace(to_char(ar.amount, 'FM9999999990.00'), '.', ','), ', ' ORDER BY ar.due_date)
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
    UPDATE public.payment_proofs
       SET customer_id = COALESCE(customer_id, v_customer),
           settlement_status = 'pendente',
           settlement_note = 'Erro na baixa automática: ' || left(SQLERRM, 200)
     WHERE id = NEW.id;
  END;

  RETURN NULL;
END;
$$;
