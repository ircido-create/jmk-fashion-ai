-- alterar_item_venda: as parcelas em aberto passam a ser REDIVIDIDAS igualmente.
--
-- Antes (20261005120000) a diferença era tirada/somada em partes iguais de cada
-- parcela; se as parcelas já eram diferentes, continuavam diferentes. Caso
-- CLAUDINETE (05/10/2026): parcelas 140/200/240/240, item de R$ 280 excluído →
-- 70/130/170/170, quando a loja esperava 4× R$ 135. Agora o novo saldo em aberto
-- da venda (saldo atual ± diferença) é dividido igualmente entre as parcelas em
-- aberto, mantendo as datas; centavos que sobram vão na parcela que vence por
-- último. Se o saldo zerar, parcelas sem pagamento somem e as com pagamento
-- parcial ficam pagas. O resto da regra não muda.

CREATE OR REPLACE FUNCTION public.alterar_item_venda(p_item_id uuid, p_nova_quantidade integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.sale_items%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_dif_qtd integer;
  v_dif_valor numeric;
  v_aberto numeric;
  v_novo_aberto numeric;
  v_n integer;
  v_parte numeric;
  v_resto numeric;
  v_r record;
  v_estoque integer;
  v_nova_parcela uuid;
  v_ajustadas integer := 0;
  v_quitadas integer := 0;
  v_removidas integer := 0;
  v_nota text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'vendedor'::public.app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para alterar vendas';
  END IF;
  IF p_nova_quantidade IS NULL OR p_nova_quantidade < 0 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;

  SELECT * INTO v_item FROM public.sale_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado — recarregue a tela';
  END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = v_item.sale_id FOR UPDATE;

  v_dif_qtd := p_nova_quantidade - v_item.quantity;
  IF v_dif_qtd = 0 THEN
    RAISE EXCEPTION 'A quantidade não mudou';
  END IF;
  IF p_nova_quantidade = 0
     AND (SELECT count(*) FROM public.sale_items WHERE sale_id = v_sale.id) = 1 THEN
    RAISE EXCEPTION 'Este é o único item da venda. Para tirá-lo, exclua a venda inteira.';
  END IF;
  v_dif_valor := round(v_item.unit_price * v_dif_qtd, 2);

  IF v_item.variant_id IS NOT NULL THEN
    SELECT quantity INTO v_estoque FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
    IF v_estoque IS NOT NULL THEN
      IF v_dif_qtd > 0 AND v_estoque < v_dif_qtd THEN
        RAISE EXCEPTION 'Estoque insuficiente de % (% disponível)', v_item.product_name || coalesce(' ' || v_item.variant_label, ''), v_estoque;
      END IF;
      UPDATE public.product_variants SET quantity = quantity - v_dif_qtd WHERE id = v_item.variant_id;
    END IF;
  END IF;

  PERFORM 1 FROM public.accounts_receivable
   WHERE sale_id = v_sale.id AND status IN ('pendente', 'vencido') ORDER BY id FOR UPDATE;
  SELECT coalesce(sum(amount), 0), count(*) INTO v_aberto, v_n
    FROM public.accounts_receivable
   WHERE sale_id = v_sale.id AND status IN ('pendente', 'vencido');

  IF v_dif_valor < 0 AND v_n > 0 AND -v_dif_valor > v_aberto THEN
    RAISE EXCEPTION 'A diferença (R$ %) é maior que o saldo em aberto da venda (R$ %). A cliente já pagou mais do que passaria a dever — faça o acerto manualmente.',
      replace(to_char(-v_dif_valor, 'FM9999999990.00'), '.', ','), replace(to_char(v_aberto, 'FM9999999990.00'), '.', ',');
  END IF;

  IF v_n > 0 THEN
    v_novo_aberto := round(v_aberto + v_dif_valor, 2);
    IF v_novo_aberto = 0 THEN
      FOR v_r IN SELECT id, EXISTS (SELECT 1 FROM public.receivable_payments rp WHERE rp.receivable_id = ar.id) AS tem_pagto
                   FROM public.accounts_receivable ar
                  WHERE sale_id = v_sale.id AND status IN ('pendente', 'vencido') LOOP
        IF v_r.tem_pagto THEN
          UPDATE public.accounts_receivable SET amount = 0, status = 'pago', paid_at = now() WHERE id = v_r.id;
          v_quitadas := v_quitadas + 1;
        ELSE
          DELETE FROM public.accounts_receivable WHERE id = v_r.id;
          v_removidas := v_removidas + 1;
        END IF;
      END LOOP;
    ELSE
      -- Partes iguais; os centavos que sobram vão na parcela que vence por último.
      v_parte := trunc(v_novo_aberto / v_n, 2);
      v_resto := round(v_novo_aberto - v_parte * v_n, 2);
      FOR v_r IN SELECT id FROM public.accounts_receivable
                  WHERE sale_id = v_sale.id AND status IN ('pendente', 'vencido')
                  ORDER BY due_date DESC, created_at DESC LOOP
        UPDATE public.accounts_receivable SET amount = v_parte + v_resto WHERE id = v_r.id;
        v_resto := 0;
        v_ajustadas := v_ajustadas + 1;
      END LOOP;
    END IF;
  ELSIF v_dif_valor > 0 AND v_sale.payment_method IN ('fiado', 'misto') THEN
    INSERT INTO public.accounts_receivable (customer_id, sale_id, description, amount, due_date, status)
    VALUES (v_sale.customer_id, v_sale.id, 'Ajuste de item — ' || v_item.product_name, v_dif_valor,
            (timezone('America/Sao_Paulo', now()))::date + 30, 'pendente')
    RETURNING id INTO v_nova_parcela;
  END IF;

  IF p_nova_quantidade = 0 THEN
    DELETE FROM public.sale_items WHERE id = v_item.id;
  ELSE
    UPDATE public.sale_items SET quantity = p_nova_quantidade WHERE id = v_item.id;
  END IF;

  v_nota := to_char(timezone('America/Sao_Paulo', now()), 'DD/MM/YYYY') || ': '
            || CASE WHEN p_nova_quantidade = 0 THEN 'item excluído — ' ELSE 'quantidade alterada — ' END
            || v_item.quantity || '× ' || v_item.product_name || coalesce(' ' || v_item.variant_label, '')
            || CASE WHEN p_nova_quantidade = 0 THEN '' ELSE ' → ' || p_nova_quantidade || '×' END
            || ' (' || CASE WHEN v_dif_valor < 0 THEN '-' ELSE '+' END || 'R$ '
            || replace(to_char(abs(v_dif_valor), 'FM9999999990.00'), '.', ',') || ')'
            || CASE WHEN v_ajustadas > 0 THEN '; saldo redividido em ' || v_ajustadas || 'x' ELSE '' END;
  UPDATE public.sales
     SET total = round(total + v_dif_valor, 2),
         notes = concat_ws(' | ', nullif(notes, ''), v_nota)
   WHERE id = v_sale.id;

  RETURN jsonb_build_object(
    'total_anterior', v_sale.total,
    'total_novo', round(v_sale.total + v_dif_valor, 2),
    'diferenca', v_dif_valor,
    'parcelas_ajustadas', v_ajustadas,
    'parcelas_quitadas', v_quitadas,
    'parcelas_removidas', v_removidas,
    'parcela_nova', v_nova_parcela IS NOT NULL,
    'sem_parcela_em_aberto', v_n = 0 AND v_nova_parcela IS NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.alterar_item_venda(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alterar_item_venda(uuid, integer) TO authenticated;
