-- Jose confirmou em 14/11/2026 que "Joyale" e "Joyaly" sao o mesmo fornecedor.
-- A grafia que fica e "Joyaly", a que ele escolheu.
DO $joyaly$
DECLARE
  v_antes  integer;
  v_depois integer;
BEGIN
  SELECT count(*) INTO v_antes FROM products WHERE supplier = 'Joyale';

  UPDATE products SET supplier = 'Joyaly' WHERE supplier = 'Joyale';

  SELECT count(*) INTO v_depois FROM products WHERE supplier = 'Joyale';
  IF v_depois <> 0 THEN
    RAISE EXCEPTION 'Sobrou peca escrita como Joyale: %', v_depois;
  END IF;

  RAISE NOTICE 'Pecas renomeadas de Joyale para Joyaly: %', v_antes;
END;
$joyaly$;
