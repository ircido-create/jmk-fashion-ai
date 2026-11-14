-- Jose mandou em 14/11/2026 juntar "Boutique K Moda Feminina" em "Boutique K".
-- A unica peca escrita "Boutique k" (k minusculo) tambem passa a "Boutique K".
DO $boutique$
DECLARE
  v_antes  integer;
  v_depois integer;
BEGIN
  SELECT count(*) INTO v_antes
    FROM products
   WHERE supplier IN ('Boutique K Moda Feminina', 'Boutique k');

  UPDATE products
     SET supplier = 'Boutique K'
   WHERE supplier IN ('Boutique K Moda Feminina', 'Boutique k');

  SELECT count(*) INTO v_depois
    FROM products
   WHERE supplier ILIKE 'Boutique%' AND supplier <> 'Boutique K';
  IF v_depois <> 0 THEN
    RAISE EXCEPTION 'Sobrou peca com outra grafia de Boutique: %', v_depois;
  END IF;

  RAISE NOTICE 'Pecas renomeadas para Boutique K: %', v_antes;
END;
$boutique$;
