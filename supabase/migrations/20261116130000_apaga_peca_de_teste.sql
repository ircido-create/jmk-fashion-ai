-- Apaga a peca de teste "BLUSA TESTE" (fornecedor TESTE), criada em 14/11/2026,
-- junto com o pedido da loja e a venda de R$ 10 que o teste gerou. Autorizado
-- pelo Jose em 16/11/2026: eram R$ 10 falsos no faturamento do dia 14.
--
-- A ordem segue as chaves estrangeiras; store_orders.sale_id aponta para sales,
-- entao o pedido sai antes da venda. As travas impedem que isso encoste em
-- qualquer venda ou pedido que tenha outra peca junto.

DO $jmk$
DECLARE
  v_produto uuid;
  v_vendas  uuid[];
  v_pedidos uuid[];
BEGIN
  SELECT id INTO v_produto FROM public.products WHERE supplier = 'TESTE';

  IF v_produto IS NULL THEN
    RAISE NOTICE 'Nenhuma peca do fornecedor TESTE: nada a fazer.';
    RETURN;
  END IF;

  IF (SELECT count(*) FROM public.products WHERE supplier = 'TESTE') <> 1 THEN
    RAISE EXCEPTION 'Esperava uma unica peca do fornecedor TESTE; achei outra coisa.';
  END IF;

  SELECT coalesce(array_agg(DISTINCT sale_id), '{}')
    INTO v_vendas FROM public.sale_items WHERE product_id = v_produto;
  SELECT coalesce(array_agg(DISTINCT order_id), '{}')
    INTO v_pedidos FROM public.store_order_items WHERE product_id = v_produto;

  -- Trava: so apago venda/pedido que contenham exclusivamente a peca de teste.
  IF EXISTS (SELECT 1 FROM public.sale_items
              WHERE sale_id = ANY(v_vendas) AND product_id <> v_produto) THEN
    RAISE EXCEPTION 'A venda ligada a peca de teste tem outras pecas: nao vou apagar.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.store_order_items
              WHERE order_id = ANY(v_pedidos) AND product_id <> v_produto) THEN
    RAISE EXCEPTION 'O pedido ligado a peca de teste tem outras pecas: nao vou apagar.';
  END IF;

  -- Filhos da peca
  DELETE FROM public.pre_sale_items    WHERE product_id = v_produto;
  DELETE FROM public.status_posts      WHERE product_id = v_produto;
  DELETE FROM public.sale_items        WHERE product_id = v_produto;
  DELETE FROM public.store_order_items WHERE product_id = v_produto;

  -- Filhos do pedido, depois o pedido (que referencia a venda)
  DELETE FROM public.store_order_alerts WHERE order_id = ANY(v_pedidos);
  DELETE FROM public.payment_charges    WHERE order_id = ANY(v_pedidos);
  DELETE FROM public.store_orders       WHERE id       = ANY(v_pedidos);

  -- Filhos da venda, depois a venda
  DELETE FROM public.accounts_receivable WHERE sale_id = ANY(v_vendas);
  DELETE FROM public.sales               WHERE id      = ANY(v_vendas);

  -- Por fim a peca
  DELETE FROM public.product_variants WHERE product_id = v_produto;
  DELETE FROM public.products         WHERE id         = v_produto;

  IF EXISTS (SELECT 1 FROM public.products WHERE supplier = 'TESTE') THEN
    RAISE EXCEPTION 'Sobrou peca do fornecedor TESTE.';
  END IF;

  RAISE NOTICE 'Apagados: a peca, % venda(s) e % pedido(s) da loja.',
    coalesce(array_length(v_vendas, 1), 0), coalesce(array_length(v_pedidos, 1), 0);
END
$jmk$;
