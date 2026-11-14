-- Jose confirmou em 14/11/2026 que "PAIS COMERCIO DE ROUPAS LTDA" e a razao
-- social da LUCIANA PAIS. As pecas passam para "LUCIANA PAIS".
DO $pais$
DECLARE
  v_antes  integer;
  v_depois integer;
BEGIN
  SELECT count(*) INTO v_antes
    FROM products
   WHERE supplier = 'PAIS COMERCIO DE ROUPAS LTDA';

  UPDATE products
     SET supplier = 'LUCIANA PAIS'
   WHERE supplier = 'PAIS COMERCIO DE ROUPAS LTDA';

  SELECT count(*) INTO v_depois
    FROM products
   WHERE supplier ILIKE '%PAIS%' AND supplier <> 'LUCIANA PAIS';
  IF v_depois <> 0 THEN
    RAISE EXCEPTION 'Sobrou peca com outra grafia de PAIS: %', v_depois;
  END IF;

  RAISE NOTICE 'Pecas renomeadas para LUCIANA PAIS: %', v_antes;
END;
$pais$;
