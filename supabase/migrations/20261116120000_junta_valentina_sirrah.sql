-- Fornecedor: VALENTINA SIRAH passa a ser VALENTINA SIRRAH (decisao do Jose em 16/11/2026).
-- A grafia com dois R e a correta: a unica peca cadastrada como "VALENTINA SIRAH"
-- se chama "VESTIDO SIRRAH", e as outras duas ja estao em "VALENTINA SIRRAH".

DO $jmk$
DECLARE
  v_antes  integer;
  v_depois integer;
  v_total  integer;
BEGIN
  SELECT count(*) INTO v_antes
    FROM public.products WHERE supplier = 'VALENTINA SIRAH';

  UPDATE public.products
     SET supplier = 'VALENTINA SIRRAH'
   WHERE supplier = 'VALENTINA SIRAH';

  UPDATE public.accounts_payable
     SET supplier = 'VALENTINA SIRRAH'
   WHERE supplier = 'VALENTINA SIRAH';

  UPDATE public.imported_romaneios
     SET supplier = 'VALENTINA SIRRAH'
   WHERE supplier = 'VALENTINA SIRAH';

  SELECT (SELECT count(*) FROM public.products           WHERE supplier = 'VALENTINA SIRAH')
       + (SELECT count(*) FROM public.accounts_payable   WHERE supplier = 'VALENTINA SIRAH')
       + (SELECT count(*) FROM public.imported_romaneios WHERE supplier = 'VALENTINA SIRAH')
    INTO v_depois;

  IF v_depois <> 0 THEN
    RAISE EXCEPTION 'Sobraram % registros com a grafia antiga VALENTINA SIRAH', v_depois;
  END IF;

  SELECT count(*) INTO v_total
    FROM public.products WHERE supplier = 'VALENTINA SIRRAH';

  RAISE NOTICE 'Renomeadas % pecas; VALENTINA SIRRAH ficou com % no estoque.', v_antes, v_total;
END
$jmk$;
