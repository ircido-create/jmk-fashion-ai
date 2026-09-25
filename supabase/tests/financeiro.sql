-- Testes das regras de dinheiro que ficam no banco.
--
-- Roda em qualquer ambiente, inclusive produção: tudo acontece dentro deste
-- bloco e o RAISE EXCEPTION do final desfaz cada gravação. O resultado vem na
-- própria mensagem de erro:
--   "TESTES OK: N verificações"      → tudo certo
--   "FALHOU: <o que>"                → a regra quebrou
-- Como rodar: pelo MCP do Lovable (query_database, projeto 91cebd86) ou no
-- editor SQL do Supabase, colando o arquivo inteiro.
DO $testes$
DECLARE
  v_admin uuid := (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1);
  v_vendedor uuid := (SELECT user_id FROM public.user_roles WHERE role = 'vendedor' LIMIT 1);
  c1 uuid; c2 uuid; c3 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid;
  conv uuid; msg uuid; p uuid; p2 uuid; res jsonb;
  n integer := 0;
  v_status text; v_amount numeric; v_note text; v_txt text; v_bool boolean;
BEGIN
  IF v_admin IS NULL OR v_vendedor IS NULL THEN
    RAISE EXCEPTION 'FALHOU: precisa de um admin e um vendedor em user_roles';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------- dados
  INSERT INTO public.customers (name, phone) VALUES ('TESTE FIN UM', '+55 (99) 91234-0001') RETURNING id INTO c1;
  INSERT INTO public.customers (name, phone) VALUES ('TESTE FIN DOIS', '5599912340002') RETURNING id INTO c2;
  INSERT INTO public.accounts_receivable (customer_id, description, amount, due_date, status) VALUES
    (c1, 'p1', 100, '2026-01-10', 'vencido') RETURNING id INTO r1;
  INSERT INTO public.accounts_receivable (customer_id, description, amount, due_date, status) VALUES
    (c1, 'p2', 100, '2026-02-10', 'vencido') RETURNING id INTO r2;
  INSERT INTO public.accounts_receivable (customer_id, description, amount, due_date, status) VALUES
    (c1, 'p3', 80, '2026-03-10', 'pendente') RETURNING id INTO r3;
  INSERT INTO public.accounts_receivable (customer_id, description, amount, due_date, status) VALUES
    (c2, 'q1', 75.50, '2026-04-10', 'pendente') RETURNING id INTO r4;

  -- ------------------------------------------ telefone só com dígitos
  SELECT phone INTO v_txt FROM public.customers WHERE id = c1;
  IF v_txt IS DISTINCT FROM '5599912340001' THEN RAISE EXCEPTION 'FALHOU: telefone não normalizado (%)', v_txt; END IF;
  n := n + 1;

  -- --------------------------------- conversa nova liga sozinha à cliente
  INSERT INTO public.whatsapp_conversations (customer_phone) VALUES ('5599912340002@s.whatsapp.net') RETURNING id INTO conv;
  IF (SELECT customer_id FROM public.whatsapp_conversations WHERE id = conv) IS DISTINCT FROM c2 THEN
    RAISE EXCEPTION 'FALHOU: conversa nova não foi ligada à cliente pelo telefone';
  END IF;
  n := n + 1;
  INSERT INTO public.whatsapp_messages (conversation_id, direction, content) VALUES (conv, 'inbound', '[imagem]') RETURNING id INTO msg;

  -- ------------------------------------- baixa atômica: quita + reduz
  res := public.apply_receivable_payment(
    jsonb_build_array(
      jsonb_build_object('receivable_id', r1, 'kind', 'settle', 'amount_paid', 100, 'expected_amount', 100),
      jsonb_build_object('receivable_id', r2, 'kind', 'reduce', 'amount_paid', 30, 'expected_amount', 100)),
    '2026-09-20 12:00-03', NULL, jsonb_build_object('description', 'teste', 'customer_id', c1));
  p := (res->>'proof_id')::uuid;
  SELECT status INTO v_status FROM public.accounts_receivable WHERE id = r1;
  IF v_status <> 'pago' THEN RAISE EXCEPTION 'FALHOU: baixa não quitou p1 (%)', v_status; END IF;
  SELECT amount INTO v_amount FROM public.accounts_receivable WHERE id = r2;
  IF v_amount <> 70 THEN RAISE EXCEPTION 'FALHOU: baixa não reduziu p2 para 70 (%)', v_amount; END IF;
  IF (SELECT count(*) FROM public.receivable_payments WHERE proof_id = p) <> 2 THEN
    RAISE EXCEPTION 'FALHOU: baixa não gravou os 2 vínculos';
  END IF;
  IF (SELECT settlement_status FROM public.payment_proofs WHERE id = p) <> 'manual' THEN
    RAISE EXCEPTION 'FALHOU: comprovante da baixa não ficou como baixa manual';
  END IF;
  n := n + 4;

  -- ------------------------- baixa repetida é recusada e não grava nada
  v_bool := false;
  BEGIN
    PERFORM public.apply_receivable_payment(
      jsonb_build_array(jsonb_build_object('receivable_id', r1, 'kind', 'settle', 'amount_paid', 100, 'expected_amount', 100)),
      now(), NULL, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_bool := true;
  END;
  IF NOT v_bool THEN RAISE EXCEPTION 'FALHOU: baixa repetida numa parcela paga foi aceita'; END IF;
  n := n + 1;

  -- ----------------------- saldo desatualizado (tela antiga) é recusado
  v_bool := false;
  BEGIN
    PERFORM public.apply_receivable_payment(
      jsonb_build_array(jsonb_build_object('receivable_id', r2, 'kind', 'settle', 'amount_paid', 100, 'expected_amount', 100)),
      now(), NULL, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_bool := true;
  END;
  IF NOT v_bool THEN RAISE EXCEPTION 'FALHOU: baixa com saldo desatualizado foi aceita'; END IF;
  n := n + 1;

  -- -------------- tudo ou nada: a 2ª parcela inválida desfaz a 1ª
  BEGIN
    PERFORM public.apply_receivable_payment(
      jsonb_build_array(
        jsonb_build_object('receivable_id', r3, 'kind', 'settle', 'amount_paid', 80, 'expected_amount', 80),
        jsonb_build_object('receivable_id', r4, 'kind', 'reduce', 'amount_paid', 90, 'expected_amount', 75.5)),
      now(), NULL, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF (SELECT status FROM public.accounts_receivable WHERE id = r3) <> 'pendente' THEN
    RAISE EXCEPTION 'FALHOU: baixa parcial — p3 ficou paga mesmo com a outra parcela inválida';
  END IF;
  n := n + 1;

  -- ------------------------------- estorno devolve as duas parcelas
  res := public.reverse_payment_proof(p);
  IF (SELECT status FROM public.accounts_receivable WHERE id = r1) = 'pago' THEN
    RAISE EXCEPTION 'FALHOU: estorno não reabriu p1';
  END IF;
  IF (SELECT amount FROM public.accounts_receivable WHERE id = r2) <> 100 THEN
    RAISE EXCEPTION 'FALHOU: estorno não devolveu os 30 da p2';
  END IF;
  IF (res->>'restored_total')::numeric <> 130 THEN RAISE EXCEPTION 'FALHOU: estorno total % (esperado 130)', res->>'restored_total'; END IF;
  n := n + 3;

  -- -------- baixa automática: valor igual quita a parcela mais antiga
  INSERT INTO public.payment_proofs (storage_path, source, whatsapp_message_id, ai_is_payment_proof, ai_amount, ai_transaction_id)
  VALUES ('t1', 'monica', msg, true, 75.5, 'E2E-TESTE-FIN-1') RETURNING id INTO p;
  SELECT settlement_status, settlement_note INTO v_status, v_note FROM public.payment_proofs WHERE id = p;
  IF v_status <> 'auto' THEN RAISE EXCEPTION 'FALHOU: baixa automática não aconteceu (% / %)', v_status, v_note; END IF;
  IF (SELECT status FROM public.accounts_receivable WHERE id = r4) <> 'pago' THEN
    RAISE EXCEPTION 'FALHOU: baixa automática não quitou a parcela de 75,50';
  END IF;
  n := n + 2;

  -- ----------------------- mesmo ID de transação reenviado → pendente
  INSERT INTO public.payment_proofs (storage_path, source, whatsapp_message_id, ai_is_payment_proof, ai_amount, ai_transaction_id)
  VALUES ('t2', 'monica', msg, true, 75.5, 'e2e-teste-fin-1') RETURNING id INTO p2;
  SELECT settlement_status, settlement_note INTO v_status, v_note FROM public.payment_proofs WHERE id = p2;
  IF v_status <> 'pendente' OR v_note NOT LIKE '%repetido%' THEN
    RAISE EXCEPTION 'FALHOU: comprovante repetido não ficou pendente (% / %)', v_status, v_note;
  END IF;
  n := n + 1;

  -- ---- valor diferente das parcelas: quita a mais antiga e reduz a próxima
  -- (c1 em aberto: p1 100 jan, p2 100 fev, p3 80 mar)
  INSERT INTO public.payment_proofs (storage_path, source, customer_id, ai_is_payment_proof, ai_amount, ai_transaction_id)
  VALUES ('t3', 'monica', c1, true, 130, 'E2E-TESTE-FIN-3') RETURNING id INTO p2;
  SELECT settlement_status, settlement_note INTO v_status, v_note FROM public.payment_proofs WHERE id = p2;
  IF v_status <> 'auto' THEN RAISE EXCEPTION 'FALHOU: 130 contra parcelas de 100 não deu baixa automática (% / %)', v_status, v_note; END IF;
  IF (SELECT status FROM public.accounts_receivable WHERE id = r1) <> 'pago' THEN
    RAISE EXCEPTION 'FALHOU: baixa automática não quitou a parcela mais antiga';
  END IF;
  IF (SELECT amount FROM public.accounts_receivable WHERE id = r2) <> 70 THEN
    RAISE EXCEPTION 'FALHOU: baixa automática não reduziu a segunda parcela para 70';
  END IF;
  IF (SELECT amount FROM public.accounts_receivable WHERE id = r3) <> 80 THEN
    RAISE EXCEPTION 'FALHOU: baixa automática mexeu na parcela mais nova';
  END IF;
  IF (SELECT sum(amount_paid) FROM public.receivable_payments WHERE proof_id = p2) <> 130 THEN
    RAISE EXCEPTION 'FALHOU: vínculos da baixa automática não somam 130';
  END IF;
  n := n + 5;

  -- ---------- valor maior que todo o saldo → pendente, nada é baixado
  INSERT INTO public.payment_proofs (storage_path, source, customer_id, ai_is_payment_proof, ai_amount, ai_transaction_id)
  VALUES ('t4', 'monica', c1, true, 1000, 'E2E-TESTE-FIN-4') RETURNING id INTO p2;
  SELECT settlement_status, settlement_note INTO v_status, v_note FROM public.payment_proofs WHERE id = p2;
  IF v_status <> 'pendente' OR v_note NOT LIKE '%150,00%' THEN
    RAISE EXCEPTION 'FALHOU: valor acima do saldo deveria ficar pendente citando 150,00 (% / %)', v_status, v_note;
  END IF;
  IF (SELECT amount FROM public.accounts_receivable WHERE id = r2) <> 70 THEN
    RAISE EXCEPTION 'FALHOU: valor acima do saldo mexeu nas parcelas';
  END IF;
  n := n + 2;

  -- ------------------------------- admin descarta e reabre pendente
  PERFORM public.set_payment_proof_pending_status(p2, true);
  IF (SELECT settlement_status FROM public.payment_proofs WHERE id = p2) <> 'ignorado' THEN
    RAISE EXCEPTION 'FALHOU: descartar comprovante';
  END IF;
  PERFORM public.set_payment_proof_pending_status(p2, false);
  IF (SELECT settlement_status FROM public.payment_proofs WHERE id = p2) <> 'pendente' THEN
    RAISE EXCEPTION 'FALHOU: reabrir comprovante';
  END IF;
  n := n + 2;

  -- ------- junção de cadastros leva parcelas E conversa, nome vira apelido
  INSERT INTO public.customers (name) VALUES ('Apelido Zap') RETURNING id INTO c3;
  UPDATE public.whatsapp_conversations SET customer_id = c3 WHERE id = conv;
  INSERT INTO public.accounts_receivable (customer_id, description, amount, due_date, status) VALUES
    (c3, 'z1', 10, '2026-05-10', 'pendente') RETURNING id INTO r5;
  res := public.merge_customers(c2, c3);
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = c3) THEN RAISE EXCEPTION 'FALHOU: cadastro duplicado não foi removido'; END IF;
  IF (SELECT customer_id FROM public.whatsapp_conversations WHERE id = conv) <> c2 THEN
    RAISE EXCEPTION 'FALHOU: junção não levou a conversa';
  END IF;
  IF (SELECT customer_id FROM public.accounts_receivable WHERE id = r5) <> c2 THEN
    RAISE EXCEPTION 'FALHOU: junção não levou a parcela';
  END IF;
  IF (SELECT nickname FROM public.customers WHERE id = c2) IS DISTINCT FROM 'Apelido Zap' THEN
    RAISE EXCEPTION 'FALHOU: nome do cadastro juntado não virou apelido';
  END IF;
  n := n + 4;

  -- --------------------------------------------------- permissões
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vendedor, 'role', 'authenticated')::text, true);
  v_bool := false;
  BEGIN PERFORM public.merge_customers(c1, c2); EXCEPTION WHEN OTHERS THEN v_bool := true; END;
  IF NOT v_bool THEN RAISE EXCEPTION 'FALHOU: vendedor conseguiu juntar cadastros'; END IF;
  v_bool := false;
  BEGIN PERFORM public.reverse_payment_proof(p); EXCEPTION WHEN OTHERS THEN v_bool := true; END;
  IF NOT v_bool THEN RAISE EXCEPTION 'FALHOU: vendedor conseguiu estornar'; END IF;
  -- vendedor PODE dar baixa
  res := public.apply_receivable_payment(
    jsonb_build_array(jsonb_build_object('receivable_id', r3, 'kind', 'settle', 'amount_paid', 80, 'expected_amount', 80)),
    now(), NULL, '{}'::jsonb);
  PERFORM set_config('request.jwt.claims', '', true);
  v_bool := false;
  BEGIN
    PERFORM public.apply_receivable_payment(
      jsonb_build_array(jsonb_build_object('receivable_id', r2, 'kind', 'settle', 'amount_paid', 100, 'expected_amount', 100)),
      now(), NULL, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_bool := true;
  END;
  IF NOT v_bool THEN RAISE EXCEPTION 'FALHOU: baixa sem login foi aceita'; END IF;
  n := n + 4;

  RAISE EXCEPTION 'TESTES OK: % verificações', n;
END $testes$;
