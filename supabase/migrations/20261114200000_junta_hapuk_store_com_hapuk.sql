-- Jose confirmou em 14/11/2026 que "Hapuk - Store" e "Hapuk" sao o mesmo fornecedor.
-- A grafia que fica e "Hapuk".
DO $hapuk$
DECLARE
  v_antes  integer;
  v_depois integer;
BEGIN
  SELECT count(*) INTO v_antes FROM products WHERE supplier = 'Hapuk - Store';

  UPDATE products SET supplier = 'Hapuk' WHERE supplier = 'Hapuk - Store';

  SELECT count(*) INTO v_depois FROM products WHERE supplier = 'Hapuk - Store';
  IF v_depois <> 0 THEN
    RAISE EXCEPTION 'Sobrou peca escrita como Hapuk - Store: %', v_depois;
  END IF;

  RAISE NOTICE 'Pecas renomeadas de Hapuk - Store para Hapuk: %', v_antes;
END;
$hapuk$;
