-- Jose mandou em 14/11/2026 juntar "LUCIAN PAIS" e "LUCINA PAIS" em "LUCIANA PAIS".
-- "PAIS COMERCIO DE ROUPAS LTDA" fica de fora: ele ainda nao decidiu.
DO $luciana$
DECLARE
  v_antes  integer;
  v_depois integer;
BEGIN
  SELECT count(*) INTO v_antes
    FROM products
   WHERE supplier IN ('LUCIAN PAIS', 'LUCINA PAIS');

  UPDATE products
     SET supplier = 'LUCIANA PAIS'
   WHERE supplier IN ('LUCIAN PAIS', 'LUCINA PAIS');

  SELECT count(*) INTO v_depois
    FROM products
   WHERE supplier ILIKE 'LUCI%' AND supplier <> 'LUCIANA PAIS';
  IF v_depois <> 0 THEN
    RAISE EXCEPTION 'Sobrou peca com outra grafia de LUCIANA PAIS: %', v_depois;
  END IF;

  RAISE NOTICE 'Pecas renomeadas para LUCIANA PAIS: %', v_antes;
END;
$luciana$;
