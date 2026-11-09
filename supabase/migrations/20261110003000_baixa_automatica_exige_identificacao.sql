-- Baixa automática: sem identificar a transação, não dá baixa sozinha.
--
-- O QUE ACONTECEU. Em 09/11/2026 a Elzirene ("Elza") mandou no WhatsApp a foto
-- de um comprovante de 13/06/2026 só para conferir se a chave Pix da loja ainda
-- era aquela. A leitura automática entendeu "Pix de R$ 150,00 para JASPRINT" e
-- deu baixa: a parcela 1/4 caiu de R$ 224,00 para R$ 74,00 sem ninguém ter
-- pagado nada. Ela apagou a mensagem um minuto depois e perguntou qual era a
-- chave; o dinheiro de verdade (R$ 225,00) só entrou às 15:43.
--
-- POR QUE PASSOU. A trava que existe hoje é o ID da transação: comprovante com
-- ID já recebido vira 'pendente'. Naquele comprovante a IA não conseguiu ler o
-- ID nem o nome de quem pagou — e, sem ID, nada impede o mesmo comprovante de
-- ser aproveitado de novo. A data do pagamento também não ajuda: ninguém a
-- extrai, payment_date guarda a hora em que a imagem chegou.
--
-- A varredura das 196 baixas automáticas de 23/09 a 09/11/2026 conferiu uma a
-- uma as imagens dos casos sem ID: só a da Elza estava errada. Mas das três sem
-- ID, qualquer uma poderia ter sido.
--
-- O QUE MUDA. Duas travas novas, nesta ordem:
--   1. Comprovante SEM ID de transação não recebe baixa automática: fica
--      'pendente', com a nota pedindo conferência da data. São 3 em 196 (1,5%)
--      pelo histórico — pouca conferência manual em troca de fechar o buraco.
--   2. Comprovante cujo pagamento é anterior ao envio em mais de 2 dias fica
--      'pendente'. Hoje essa trava nunca dispara, porque payment_date é a hora
--      da chegada; ela passa a valer sozinha assim que a edge function
--      bubblewhats-webhook começar a gravar a data lida do comprovante (pedido
--      separado ao agente do Lovable).
--
-- O resto da função é igual à versão 20260925180000.
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
    ELSIF NEW.payment_date IS NOT NULL
      AND NEW.payment_date < COALESCE(NEW.created_at, now()) - interval '2 days' THEN
      v_note := 'Comprovante de ' || to_char(NEW.payment_date AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
                || ', bem anterior ao envio — confira se não é pagamento antigo reenviado';
    ELSIF v_txid IS NULL AND EXISTS (
      SELECT 1 FROM public.payment_proofs o
       WHERE o.id <> NEW.id
         AND o.customer_id = v_customer
         AND round(o.ai_amount, 2) = v_amount
         AND o.created_at > NEW.created_at - interval '24 hours'
    ) THEN
      v_note := 'Possível comprovante repetido (mesmo valor nas últimas 24h, sem ID de transação)';
    ELSIF v_txid IS NULL THEN
      v_note := 'Sem ID de transação no comprovante — confira a data antes de dar baixa (pode ser comprovante antigo reenviado)';
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
