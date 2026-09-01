-- Grava a venda inteira numa única transação.
--
-- Antes, o PDV fazia cinco requisições independentes do navegador (parcelas,
-- venda, vínculo, itens, baixa de estoque). Falha no meio deixava dados órfãos
-- sem rollback: cliente devendo por venda inexistente, venda sem itens, estoque
-- não baixado. Aqui ou tudo grava, ou nada grava.
--
-- security invoker: o RLS do usuário continua valendo — a função não é um
-- desvio de permissão, só uma fronteira transacional.

CREATE OR REPLACE FUNCTION public.create_sale(
  p_customer_id    uuid,
  p_total          numeric,
  p_payment_method text,
  p_installments   int,
  p_notes          text,
  p_items          jsonb,
  p_receivables    jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_rec_ids uuid[] := '{}';
  v_new_id  uuid;
  v_rec     jsonb;
  v_item    jsonb;
  v_variant uuid;
  v_qty     int;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Venda sem itens';
  END IF;

  -- 1) Parcelas primeiro: a venda precisa do id da primeira.
  FOR v_rec IN SELECT * FROM jsonb_array_elements(COALESCE(p_receivables, '[]'::jsonb)) LOOP
    INSERT INTO accounts_receivable
      (customer_id, amount, due_date, description, status)
    VALUES (p_customer_id,
            (v_rec->>'amount')::numeric,
            (v_rec->>'due_date')::date,
            v_rec->>'description',
            'pendente')
    RETURNING id INTO v_new_id;
    v_rec_ids := v_rec_ids || v_new_id;
  END LOOP;

  -- 2) Venda
  INSERT INTO sales
    (customer_id, receivable_id, total, notes, sale_date,
     payment_method, installments)
  VALUES (p_customer_id, v_rec_ids[1], p_total, p_notes, now(),
          p_payment_method, p_installments)
  RETURNING id INTO v_sale_id;

  -- 3) Vincula as parcelas à venda
  IF array_length(v_rec_ids, 1) IS NOT NULL THEN
    UPDATE accounts_receivable
       SET sale_id = v_sale_id
     WHERE id = ANY(v_rec_ids);
  END IF;

  -- 4) Itens + baixa de estoque na mesma transação
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO sale_items
      (sale_id, product_id, variant_id, product_name,
       variant_label, quantity, unit_price, unit_cost)
    VALUES (v_sale_id,
            NULLIF(v_item->>'product_id',   '')::uuid,
            NULLIF(v_item->>'variant_id',   '')::uuid,
            v_item->>'product_name',
            NULLIF(v_item->>'variant_label', ''),
            (v_item->>'quantity')::int,
            (v_item->>'unit_price')::numeric,
            (v_item->>'unit_cost')::numeric);

    v_variant := NULLIF(v_item->>'variant_id', '')::uuid;
    v_qty     := (v_item->>'quantity')::int;

    IF v_variant IS NOT NULL THEN
      -- A condição no WHERE impede estoque negativo mesmo com duas vendas
      -- simultâneas da mesma peça: a segunda não encontra linha e aborta tudo.
      UPDATE product_variants
         SET quantity = quantity - v_qty
       WHERE id = v_variant
         AND quantity >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Estoque insuficiente para % (%)',
          v_item->>'product_name',
          COALESCE(NULLIF(v_item->>'variant_label', ''), 'sem variação');
      END IF;
    END IF;
  END LOOP;

  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale(uuid, numeric, text, int, text, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, numeric, text, int, text, jsonb, jsonb) TO authenticated;
