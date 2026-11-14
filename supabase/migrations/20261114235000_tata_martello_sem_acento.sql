-- Jose mandou em 14/11/2026 padronizar "Tata Martello" (com acento) para
-- "TATA MARTELLO", a grafia que o estoque ja usa.
-- O estoque (products) ja estava certo; faltavam as contas a pagar e os
-- romaneios importados.
DO $tata$
DECLARE
  v_contas    integer;
  v_romaneios integer;
  v_sobrou    integer;
BEGIN
  SELECT count(*) INTO v_contas
    FROM accounts_payable
   WHERE supplier ILIKE '%tat%' AND supplier <> 'TATA MARTELLO';

  UPDATE accounts_payable
     SET supplier = 'TATA MARTELLO'
   WHERE supplier ILIKE '%tat%' AND supplier <> 'TATA MARTELLO';

  SELECT count(*) INTO v_romaneios
    FROM imported_romaneios
   WHERE supplier ILIKE '%tat%' AND supplier <> 'TATA MARTELLO';

  UPDATE imported_romaneios
     SET supplier = 'TATA MARTELLO'
   WHERE supplier ILIKE '%tat%' AND supplier <> 'TATA MARTELLO';

  SELECT count(*) INTO v_sobrou
    FROM (
      SELECT supplier FROM products           WHERE supplier ILIKE '%tat%'
      UNION ALL
      SELECT supplier FROM accounts_payable   WHERE supplier ILIKE '%tat%'
      UNION ALL
      SELECT supplier FROM imported_romaneios WHERE supplier ILIKE '%tat%'
    ) t
   WHERE supplier <> 'TATA MARTELLO';
  IF v_sobrou <> 0 THEN
    RAISE EXCEPTION 'Sobrou registro com outra grafia de TATA MARTELLO: %', v_sobrou;
  END IF;

  RAISE NOTICE 'Contas a pagar: % | Romaneios: %', v_contas, v_romaneios;
END;
$tata$;
