-- Baixa automática de comprovante (WhatsApp) pelas parcelas MAIS ANTIGAS.
--
-- Antes: só dava baixa se o valor do comprovante fosse igual ao de uma parcela
-- em aberto, e quitava a mais antiga COM AQUELE VALOR — podia pular uma parcela
-- mais antiga de outro valor. Um PIX de R$ 210 contra parcelas de R$ 110 ia para
-- "aguardando baixa manual".
--
-- Agora: soma as parcelas em aberto da cliente (de todas as vendas) por ordem de
-- vencimento e aplica o valor da mais antiga para a mais nova: quita enquanto o
-- valor cobre a parcela inteira e reduz a próxima com o que sobrar. Se o valor
-- for MAIOR que tudo o que está em aberto, não aplica nada e deixa pendente para
-- conferência (sobra de dinheiro sem parcela precisa de decisão humana).
CREATE OR REPLACE FUNCTION public.auto_settle_payment_proof()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer uuid := NEW.customer_id;
  v_amount numeric := round(NEW.ai_amount, 2);
  v_txid text := NULLIF(lower(regexp_replace(COALESCE(NEW.ai_transaction_id, ''), '\s', '', 'g')), '');
  v_open_total numeric;
  v_pool numeric;
  v_left numeric;
  v_row record;
  v_parts text[] := ARRAY[]::text[];
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
      PERFORM 1 FROM public.accounts_receivable ar
        WHERE ar.customer_id = v_customer AND ar.status IN ('pendente', 'vencido')
        ORDER BY ar.id
        FOR UPDATE;

      SELECT COALESCE(round(sum(ar.amount), 2), 0) INTO v_open_total
        FROM public.accounts_receivable ar
       WHERE ar.customer_id = v_customer AND ar.status IN ('pendente', 'vencido');

      IF v_open_total = 0 THEN
        v_note := 'Cliente sem parcelas em aberto';
      ELSIF v_amount > v_open_total THEN
        v_note := 'Valor maior que o saldo em aberto (R$ '
                  || replace(to_char(v_open_total, 'FM9999999990.00'), '.', ',')
                  || ') — confira antes de dar baixa';
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

    v_pool := v_amount;
    FOR v_row IN
      SELECT ar.id, ar.amount, ar.description, ar.due_date
        FROM public.accounts_receivable ar
       WHERE ar.customer_id = v_customer AND ar.status IN ('pendente', 'vencido')
       ORDER BY ar.due_date, ar.amount, ar.created_at
    LOOP
      EXIT WHEN v_pool <= 0;
      v_left := round(v_row.amount, 2);
      CONTINUE WHEN v_left <= 0;

      IF v_pool >= v_left THEN
        UPDATE public.accounts_receivable SET status = 'pago', paid_at = now() WHERE id = v_row.id;
        INSERT INTO public.receivable_payments (receivable_id, proof_id, amount_paid) VALUES (v_row.id, NEW.id, v_left);
        v_parts := array_append(v_parts, to_char(v_row.due_date, 'DD/MM/YYYY')
                     || COALESCE(' — ' || v_row.description, '') || ' quitada');
        v_pool := round(v_pool - v_left, 2);
      ELSE
        UPDATE public.accounts_receivable SET amount = round(v_left - v_pool, 2) WHERE id = v_row.id;
        INSERT INTO public.receivable_payments (receivable_id, proof_id, amount_paid) VALUES (v_row.id, NEW.id, v_pool);
        v_parts := array_append(v_parts, to_char(v_row.due_date, 'DD/MM/YYYY')
                     || COALESCE(' — ' || v_row.description, '') || ' reduzida para R$ '
                     || replace(to_char(v_left - v_pool, 'FM9999999990.00'), '.', ','));
        v_pool := 0;
      END IF;
    END LOOP;

    UPDATE public.payment_proofs
       SET customer_id = v_customer,
           settlement_status = 'auto',
           settlement_note = left('Baixa automática: ' || array_to_string(v_parts, '; '), 500),
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
$function$;
