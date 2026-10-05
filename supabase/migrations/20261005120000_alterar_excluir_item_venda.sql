-- Alterar a quantidade de um item de venda ou excluir o item (tela Vendas).
--
-- Tudo numa transação: estoque da variação, total da venda e parcelas em aberto.
-- Regras combinadas com a loja (05/10/2026):
--   * só a QUANTIDADE muda (preço, tamanho e produto não);
--   * a diferença de valor (preço unitário × diferença de quantidade) é dividida
--     IGUALMENTE entre as parcelas em aberto da venda — para menos ou para mais;
--   * quantidade 0 = excluir o item; o último item não sai (exclua a venda);
--   * se a diferença para menos for maior que o que ainda está em aberto, recusa
--     (a cliente já pagou mais do que passaria a dever — acerto manual);
--   * venda paga à vista (sem parcelas em aberto) só muda total e estoque; se
--     aumentar uma venda no fiado sem parcela em aberto, cria uma parcela nova
--     com vencimento em 30 dias.
-- A observação da venda guarda o histórico da alteração.

CREATE OR REPLACE FUNCTION public.alterar_item_venda(p_item_id uuid, p_nova_quantidade integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.sale_items%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_dif_qtd integer;          -- positivo = cliente levou mais
  v_dif_valor numeric;        -- positivo = venda ficou mais cara
  v_aberto numeric;
  v_n integer;
  v_resto numeric;
  v_parte numeric;
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

  -- Estoque: devolve quando diminui, retira quando aumenta (sem deixar negativo).
  IF v_item.variant_id IS NOT NULL THEN
    SELECT quantity INTO v_estoque FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
    IF v_estoque IS NOT NULL THEN
      IF v_dif_qtd > 0 AND v_estoque < v_dif_qtd THEN
        RAISE EXCEPTION 'Estoque insuficiente de % (% disponível)', v_item.product_name || coalesce(' ' || v_item.variant_label, ''), v_estoque;
      END IF;
      UPDATE public.product_variants SET quantity = quantity - v_dif_qtd WHERE id = v_item.variant_id;
    END IF;
  END IF;

  -- Parcelas em aberto da venda.
  PERFORM 1 FROM public.accounts_receivable
   WHERE sale_id = v_sale.id AND status IN ('pendente', 'vencido') ORDER BY id FOR UPDATE;
  SELECT coalesce(sum(amount), 0), count(*) INTO v_aberto, v_n
    FROM public.accounts_receivable
   WHERE sale_id = v_sale.id AND status IN ('pendente', 'vencido');

  IF v_dif_valor < 0 AND v_n > 0 AND -v_dif_valor > v_aberto THEN
    RAISE EXCEPTION 'A diferença (R$ %) é maior que o saldo em aberto da venda (R$ %). A cliente já pagou mais do que passaria a dever — faça o acerto manualmente.',
      replace(to_char(-v_dif_valor, 'FM9999999990.00'), '.', ','), replace(to_char(v_aberto, 'FM9999999990.00'), '.', ',');
  END IF;

  IF v_n > 0 AND v_dif_valor > 0 THEN
    -- Para mais: soma partes iguais em cada parcela; centavos que sobram vão na última.
    v_parte := trunc(v_dif_valor / v_n, 2);
    v_resto := v_dif_valor - v_parte * v_n;
    FOR v_r IN SELECT id FROM public.accounts_receivable
                WHERE sale_id = v_sale.id AND status IN ('pendente', 'vencido')
                ORDER BY due_date DESC, created_at DESC LOOP
      UPDATE public.accounts_receivable SET amount = amount + v_parte + v_resto WHERE id = v_r.id;
      v_resto := 0;
      v_ajustadas := v_ajustadas + 1;
    END LOOP;
  ELSIF v_n > 0 AND v_dif_valor < 0 THEN
    -- Para menos: tira partes iguais; parcela menor que a parte zera e o que
    -- faltou é redividido entre as outras.
    v_resto := -v_dif_valor;
    FOR v_r IN SELECT id, amount,
                      EXISTS (SELECT 1 FROM public.receivable_payments rp WHERE rp.receivable_id = ar.id) AS tem_pagto
                 FROM public.accounts_receivable ar
                WHERE sale_id = v_sale.id AND status IN ('pendente', 'vencido')
                ORDER BY amount ASC, due_date DESC LOOP
      EXIT WHEN v_resto <= 0;
      v_parte := round(v_resto / v_n, 2);
      IF v_n = 1 THEN v_parte := v_resto; END IF;
      IF v_parte >= v_r.amount THEN
        v_resto := v_resto - v_r.amount;
        IF v_r.tem_pagto THEN
          -- já teve pagamento parcial: o que faltava foi coberto pelo ajuste
          UPDATE public.accounts_receivable SET amount = 0, status = 'pago', paid_at = now() WHERE id = v_r.id;
          v_quitadas := v_quitadas + 1;
        ELSE
          DELETE FROM public.accounts_receivable WHERE id = v_r.id;
          v_removidas := v_removidas + 1;
        END IF;
      ELSE
        UPDATE public.accounts_receivable SET amount = round(amount - v_parte, 2) WHERE id = v_r.id;
        v_resto := round(v_resto - v_parte, 2);
        v_ajustadas := v_ajustadas + 1;
      END IF;
      v_n := v_n - 1;
    END LOOP;
  ELSIF v_n = 0 AND v_dif_valor > 0 AND v_sale.payment_method IN ('fiado', 'misto') THEN
    INSERT INTO public.accounts_receivable (customer_id, sale_id, description, amount, due_date, status)
    VALUES (v_sale.customer_id, v_sale.id, 'Ajuste de item — ' || v_item.product_name, v_dif_valor,
            (timezone('America/Sao_Paulo', now()))::date + 30, 'pendente')
    RETURNING id INTO v_nova_parcela;
  END IF;

  -- Item e venda.
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
            || replace(to_char(abs(v_dif_valor), 'FM9999999990.00'), '.', ',') || ')';
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
    'sem_parcela_em_aberto', v_n = 0 AND v_ajustadas = 0 AND v_quitadas = 0 AND v_removidas = 0 AND v_nova_parcela IS NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.alterar_item_venda(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alterar_item_venda(uuid, integer) TO authenticated;
