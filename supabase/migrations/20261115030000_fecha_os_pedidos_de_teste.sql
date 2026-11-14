-- Limpeza do teste do credito sem juros (migracao 20261115020000):
-- os dois pedidos ficam como cancelados para nao aparecerem como pedido novo
-- na tela da loja. Os links do checkout morrem junto.
DO $limpa$
DECLARE
  v_n integer;
BEGIN
  UPDATE store_orders
     SET status = 'cancelado'
   WHERE (code LIKE 'TESTE350-%' OR code LIKE 'TESTE120-%')
     AND status <> 'cancelado';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Pedidos de teste fechados: %', v_n;
END;
$limpa$;
