-- MARIA ELAINE: a venda de 09/11/2026 saiu com a peça errada.
--
-- Em 03/11 ela avisou no WhatsApp: "O vestido azul Laíse de 520 é o que vou
-- devolver" e "Eu fiquei com o vestido Milene PP". Na venda lançada em
-- 09/11 (R$ 1.380,00, acordo com a dívida anterior) entrou o VESTIDO 7666
-- LAISE PP AZUL MARINHO pelo preço do Milene, R$ 420,00 — nome e estoque de
-- uma peça, valor de outra.
--
-- O dinheiro está certo: o Vestido 7371 Milene PP Azul Marinho custa
-- exatamente R$ 420,00. O que precisa mudar é qual peça saiu:
--   * o item da venda passa a ser o Milene (com o custo dele, R$ 209,90);
--   * o Laíse volta ao estoque (estava zerado e está de volta na loja);
--   * o Milene sai do estoque (está com a cliente).
--
-- O total da venda e as parcelas do acordo não mudam. A conferência no fim
-- recusa a migração se alguma dessas três coisas não fechar.
DO $troca$
DECLARE
  v_item       uuid := '426e24fb-fdff-418d-a692-fc745e6d1859';
  v_venda      uuid := '4ff53be3-23ee-4e1d-9ec0-9260a28b86c1';
  v_laise_var  uuid := '796c1eef-87a7-449b-a92c-49939faf5148';  -- 7666 Laise PP AZUL MARINHO
  v_milene_pro uuid := '93bb98ce-55e6-43ec-98c5-fff91b662200';  -- Vestido 7371 Milene
  v_milene_var uuid := '1e6f752c-a457-4911-b25b-9ba71cde9ef0';  -- 7371 Milene PP Azul Marinho
  v_preco      numeric;
  v_nome       text;
  v_total      numeric;
  v_qtd_laise  int;
  v_qtd_milene int;
  v_aberto     numeric;
BEGIN
  SELECT unit_price, product_name INTO v_preco, v_nome
    FROM public.sale_items WHERE id = v_item;

  IF v_preco IS NULL THEN
    RAISE EXCEPTION 'O item da venda não existe mais (%). Confira antes de aplicar.', v_item;
  END IF;
  IF v_nome NOT ILIKE '%7666 Laise%' THEN
    RAISE NOTICE 'O item já não é o Laíse (está como %). Nada a fazer.', v_nome;
    RETURN;
  END IF;
  IF v_preco <> 420.00 THEN
    RAISE EXCEPTION 'O item está valendo R$ % (esperado R$ 420,00). Confira a venda antes de trocar a peça.', v_preco;
  END IF;

  -- 1) a peça que saiu de verdade
  UPDATE public.sale_items
     SET product_id   = v_milene_pro,
         variant_id   = v_milene_var,
         product_name = 'Vestido 7371 Milene',
         variant_label = 'PP / Azul Marinho',
         unit_cost    = 209.90
   WHERE id = v_item;

  -- 2) estoque: o Laíse voltou, o Milene foi
  UPDATE public.product_variants SET quantity = quantity + 1 WHERE id = v_laise_var;
  UPDATE public.product_variants SET quantity = quantity - 1 WHERE id = v_milene_var;

  -- 3) conferência
  SELECT quantity INTO v_qtd_laise  FROM public.product_variants WHERE id = v_laise_var;
  SELECT quantity INTO v_qtd_milene FROM public.product_variants WHERE id = v_milene_var;
  IF v_qtd_laise <> 1 OR v_qtd_milene <> 0 THEN
    RAISE EXCEPTION 'O estoque ficou errado: Laíse % e Milene % (esperado 1 e 0).', v_qtd_laise, v_qtd_milene;
  END IF;

  SELECT total INTO v_total FROM public.sales WHERE id = v_venda;
  IF v_total <> 1380.00 THEN
    RAISE EXCEPTION 'A venda ficou R$ % (esperado R$ 1.380,00).', v_total;
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_aberto
    FROM public.accounts_receivable
   WHERE customer_id = 'ca77b1cb-df87-4e63-b8c6-135c56d42c17'
     AND status IN ('pendente', 'vencido');
  IF v_aberto <> 2360.00 THEN
    RAISE EXCEPTION 'O saldo da cliente mudou: R$ % (esperado R$ 2.360,00).', v_aberto;
  END IF;
END
$troca$;
