-- Tira do painel os dois pedidos de teste do pagamento online.
--
-- São os de hoje, 11/11/2026, criados para conferir que a loja passou a
-- assumir a taxa do crédito à vista:
--     TESTE-11111432     R$  1,00
--     TESTE60-11111438   R$ 60,00
--
-- Nenhum dos dois foi pago — conferido antes: cobrança 'aguardando', zero
-- linhas em payment_transactions e zero avisos enviados. Não há dinheiro,
-- nem venda, nem mensagem para ninguém nesses registros; é só lixo de teste.
-- Os itens e as cobranças saem junto, por cascata.
--
-- O QUE NÃO SOME. Os links já criados continuam de pé na InfinitePay até
-- vencerem — a API dela não cancela link. Depois desta limpeza eles não têm
-- mais pedido no sistema, então ninguém deve usá-los: um pagamento feito por
-- ali ficaria órfão, sem cobrança para casar.
--
-- Pedido pelo José em 11/11/2026, ciente de que a exclusão é definitiva.
DO $limpa$
DECLARE
  v_qtd   int;
  v_pagos int;
  v_tx    int;
  v_resta int;
BEGIN
  SELECT count(*) INTO v_qtd
    FROM public.store_orders
   WHERE customer_name = 'TESTE PAGAMENTO ONLINE';

  IF v_qtd <> 2 THEN
    RAISE EXCEPTION 'Esperava 2 pedidos de teste e achei % — confira antes de apagar.', v_qtd;
  END IF;

  SELECT count(*) INTO v_pagos
    FROM public.payment_charges c
    JOIN public.store_orders o ON o.id = c.order_id
   WHERE o.customer_name = 'TESTE PAGAMENTO ONLINE'
     AND (c.status = 'pago' OR c.paid_cents IS NOT NULL);

  IF v_pagos > 0 THEN
    RAISE EXCEPTION '% cobrança(s) de teste constam como pagas. Não apago nada.', v_pagos;
  END IF;

  SELECT count(*) INTO v_tx
    FROM public.payment_transactions t
    JOIN public.payment_charges c ON c.id = t.charge_id
    JOIN public.store_orders o ON o.id = c.order_id
   WHERE o.customer_name = 'TESTE PAGAMENTO ONLINE';

  IF v_tx > 0 THEN
    RAISE EXCEPTION '% transação(ões) ligadas aos pedidos de teste. Não apago nada.', v_tx;
  END IF;

  DELETE FROM public.store_orders
   WHERE customer_name = 'TESTE PAGAMENTO ONLINE';

  SELECT count(*) INTO v_resta
    FROM public.store_orders
   WHERE customer_name = 'TESTE PAGAMENTO ONLINE';

  IF v_resta <> 0 THEN
    RAISE EXCEPTION 'Sobraram % pedidos de teste depois da limpeza.', v_resta;
  END IF;
END
$limpa$;
