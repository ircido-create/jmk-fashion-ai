-- Jose mandou em 14/11/2026 aplicar as mesmas unificacoes de fornecedor nas
-- contas a pagar e nos romaneios importados, nao so no estoque.
-- Das grafias unificadas hoje, so estas tres aparecem fora do estoque.
-- "RK FONSECA COMERCIO DE CONFECCOES LTDA" fica como esta: ele nao decidiu.
DO $padroniza$
DECLARE
  v_contas    integer;
  v_romaneios integer;
  v_sobrou    integer;
BEGIN
  WITH de_para(antigo, novo) AS (
    VALUES ('Hapuk - Store', 'Hapuk'),
           ('Joyale', 'Joyaly'),
           ('PAIS COMERCIO DE ROUPAS LTDA', 'LUCIANA PAIS')
  ),
  c AS (
    UPDATE accounts_payable a SET supplier = d.novo
      FROM de_para d WHERE a.supplier = d.antigo
    RETURNING 1
  )
  SELECT count(*) INTO v_contas FROM c;

  WITH de_para(antigo, novo) AS (
    VALUES ('Hapuk - Store', 'Hapuk'),
           ('Joyale', 'Joyaly'),
           ('PAIS COMERCIO DE ROUPAS LTDA', 'LUCIANA PAIS')
  ),
  r AS (
    UPDATE imported_romaneios i SET supplier = d.novo
      FROM de_para d WHERE i.supplier = d.antigo
    RETURNING 1
  )
  SELECT count(*) INTO v_romaneios FROM r;

  SELECT count(*) INTO v_sobrou
    FROM (
      SELECT supplier FROM accounts_payable   WHERE supplier IS NOT NULL
      UNION ALL
      SELECT supplier FROM imported_romaneios WHERE supplier IS NOT NULL
    ) t
   WHERE t.supplier IN ('Hapuk - Store', 'Joyale', 'PAIS COMERCIO DE ROUPAS LTDA');
  IF v_sobrou <> 0 THEN
    RAISE EXCEPTION 'Sobrou registro com grafia antiga: %', v_sobrou;
  END IF;

  RAISE NOTICE 'Contas ajustadas: % | Romaneios ajustados: %', v_contas, v_romaneios;
END;
$padroniza$;
