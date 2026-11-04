-- Volta ao estoque o VESTIDO MARIA AMORE 2846, devolvido pela CLAUDINETE.
--
-- Ela comprou o vestido branco em 26/09/2026 por R$ 280,00, avisou em 02/10 que
-- "ficou enorme de grande" e mandou de volta: a peca chegou na loja em
-- 14/10/2026. A venda ja foi corrigida no mesmo dia 05/10 (o item saiu do total
-- e as parcelas viraram 4x R$ 135,00), mas o vestido nunca entrou no estoque —
-- a venda foi lancada com pecas avulsas (product_id nulo), entao nao havia
-- produto para devolver.
--
-- Aqui a peca e cadastrada como qualquer outra da Maria Amore: sku igual ao
-- codigo do fornecedor, preco = custo x 2, uma variante com a quantidade que
-- esta fisicamente na loja. Fica fora da loja virtual (store_visible = false),
-- como todas as pecas desse fornecedor.
--
-- Rodar de novo nao duplica: se o produto ja existir, a migracao nao faz nada.
DO $vestido$
DECLARE
  v_produto uuid;
  v_qtd     int;
BEGIN
  SELECT id INTO v_produto
    FROM products
   WHERE supplier ILIKE 'maria amore' AND sku = '2846'
   LIMIT 1;

  IF v_produto IS NOT NULL THEN
    RAISE NOTICE 'VESTIDO MARIA AMORE 2846 ja esta cadastrado (%). Nada a fazer.', v_produto;
    RETURN;
  END IF;

  INSERT INTO products (name, sku, supplier, garment_type, price, cost, active, is_draft, store_visible, description)
  VALUES ('VESTIDO MARIA AMORE 2846',
          '2846',
          'Maria Amore',
          'vestido',
          280.00,
          140.00,
          true,
          false,
          false,
          'Devolucao de CLAUDINETE LOPES DA COSTA (venda de 26/09/2026, peca recebida em 14/10/2026).')
  RETURNING id INTO v_produto;

  INSERT INTO product_variants (product_id, size, color, quantity)
  VALUES (v_produto, 'P', 'BRANCO', 1);

  -- conferencia: um produto, uma variante, uma peca
  SELECT coalesce(sum(quantity), 0) INTO v_qtd
    FROM product_variants WHERE product_id = v_produto;

  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'O estoque da peca ficou em % (esperado 1).', v_qtd;
  END IF;
END
$vestido$;
