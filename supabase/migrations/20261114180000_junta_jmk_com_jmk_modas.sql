-- Jose confirmou em 14/11/2026 que "JMK" e "JMK MODAS" sao a mesma loja (a dele).
-- A grafia que fica e "JMK MODAS", o nome completo, mesmo nao sendo a mais usada.
-- Os outros parecidos (HELP CHIC/HELP CHIK, CECHIC/CECHIQ, SORENZO/Sorenzza)
-- ele confirmou que sao lojas DIFERENTES e nao devem ser juntados.
DO $jmk$
DECLARE
  v_antes  integer;
  v_depois integer;
BEGIN
  SELECT count(*) INTO v_antes FROM products WHERE supplier = 'JMK';

  UPDATE products SET supplier = 'JMK MODAS' WHERE supplier = 'JMK';

  SELECT count(*) INTO v_depois FROM products WHERE supplier = 'JMK';
  IF v_depois <> 0 THEN
    RAISE EXCEPTION 'Sobrou peca escrita como JMK: %', v_depois;
  END IF;

  RAISE NOTICE 'Pecas renomeadas de JMK para JMK MODAS: %', v_antes;
END;
$jmk$;
