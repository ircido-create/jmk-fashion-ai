-- Correção de merge_customers (23/09/2026).
--
-- `v_filled := v_filled || 'apelido'` fazia o Postgres ler 'apelido' como um
-- array literal e a junção quebrava com "malformed array literal" sempre que
-- algum campo era completado — o caso dos pares criados pelo WhatsApp, em que
-- o nome do outro cadastro vira apelido. Achado pela bateria
-- supabase/tests/financeiro.sql. Nenhuma junção chegou a ser gravada pela
-- metade: o erro desfazia a transação inteira.

CREATE OR REPLACE FUNCTION public.merge_customers(p_keep uuid, p_drop uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_keep public.customers%ROWTYPE;
  v_drop public.customers%ROWTYPE;
  v_moves jsonb := '{}'::jsonb;
  v_count integer;
  v_table text;
  v_filled text[] := ARRAY[]::text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Somente administradores podem juntar cadastros';
  END IF;
  IF p_keep IS NULL OR p_drop IS NULL OR p_keep = p_drop THEN
    RAISE EXCEPTION 'Escolha dois cadastros diferentes';
  END IF;

  SELECT * INTO v_keep FROM public.customers WHERE id = p_keep FOR UPDATE;
  SELECT * INTO v_drop FROM public.customers WHERE id = p_drop FOR UPDATE;
  IF v_keep.id IS NULL OR v_drop.id IS NULL THEN
    RAISE EXCEPTION 'Cadastro não encontrado — recarregue a tela';
  END IF;

  -- Move todas as referências.
  FOREACH v_table IN ARRAY ARRAY['accounts_receivable', 'sales', 'pre_sales', 'payment_proofs',
                                 'whatsapp_conversations', 'dunning_logs', 'store_orders'] LOOP
    EXECUTE format('UPDATE public.%I SET customer_id = $1 WHERE customer_id = $2', v_table)
      USING p_keep, p_drop;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moves := v_moves || jsonb_build_object(v_table, v_count);
  END LOOP;

  -- Completa o que falta no cadastro mantido. O nome do outro cadastro
  -- (em geral o apelido do WhatsApp) vira apelido, se não houver um.
  IF v_keep.nickname IS NULL OR trim(v_keep.nickname) = '' THEN
    IF v_drop.nickname IS NOT NULL AND trim(v_drop.nickname) <> '' THEN
      v_keep.nickname := v_drop.nickname; v_filled := array_append(v_filled, 'apelido');
    ELSIF v_drop.name IS NOT NULL AND v_drop.name <> '(sem nome)' AND lower(trim(v_drop.name)) <> lower(trim(v_keep.name)) THEN
      v_keep.nickname := v_drop.name; v_filled := array_append(v_filled, 'apelido');
    END IF;
  END IF;
  IF (v_keep.tax_id IS NULL OR v_keep.tax_id = '') AND v_drop.tax_id IS NOT NULL AND v_drop.tax_id <> '' THEN
    v_keep.tax_id := v_drop.tax_id; v_filled := array_append(v_filled, 'CPF/CNPJ');
  END IF;
  IF v_keep.phone IS NULL AND v_drop.phone IS NOT NULL THEN
    v_keep.phone := v_drop.phone; v_filled := array_append(v_filled, 'telefone');
  END IF;
  IF (v_keep.email IS NULL OR v_keep.email = '') AND v_drop.email IS NOT NULL AND v_drop.email <> '' THEN
    v_keep.email := v_drop.email; v_filled := array_append(v_filled, 'e-mail');
  END IF;
  IF (v_keep.address IS NULL OR v_keep.address = '') AND v_drop.address IS NOT NULL AND v_drop.address <> '' THEN
    v_keep.address := v_drop.address; v_filled := array_append(v_filled, 'endereço');
  END IF;
  IF v_drop.notes IS NOT NULL AND v_drop.notes <> '' THEN
    v_keep.notes := CASE WHEN v_keep.notes IS NULL OR v_keep.notes = '' THEN v_drop.notes
                         ELSE v_keep.notes || E'\n' || v_drop.notes END;
    v_filled := array_append(v_filled, 'observações');
  END IF;

  DELETE FROM public.customer_merge_ignored WHERE customer_a_id = p_drop OR customer_b_id = p_drop;
  DELETE FROM public.customers WHERE id = p_drop;

  UPDATE public.customers
     SET nickname = v_keep.nickname, tax_id = v_keep.tax_id, phone = v_keep.phone,
         email = v_keep.email, address = v_keep.address, notes = v_keep.notes
   WHERE id = p_keep;

  RETURN jsonb_build_object('moves', v_moves, 'filled', to_jsonb(v_filled));
END;
$$;
