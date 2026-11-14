-- Jose mandou em 14/11/2026 juntar "FEMININE & FASHION" e "FEMININI" em "FEMININE".
DO $feminine$
DECLARE
  v_antes  integer;
  v_depois integer;
BEGIN
  SELECT count(*) INTO v_antes
    FROM products
   WHERE supplier IN ('FEMININE & FASHION', 'FEMININI');

  UPDATE products
     SET supplier = 'FEMININE'
   WHERE supplier IN ('FEMININE & FASHION', 'FEMININI');

  SELECT count(*) INTO v_depois
    FROM products
   WHERE supplier ILIKE 'FEMININ%' AND supplier <> 'FEMININE';
  IF v_depois <> 0 THEN
    RAISE EXCEPTION 'Sobrou peca com outra grafia de FEMININE: %', v_depois;
  END IF;

  RAISE NOTICE 'Pecas renomeadas para FEMININE: %', v_antes;
END;
$feminine$;
