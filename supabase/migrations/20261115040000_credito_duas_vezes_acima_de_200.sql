-- Credito sem juros da loja virtual: passa de 3x acima de R$ 300 para 2x acima de R$ 200.
-- A regra mora em public.store_settings; a vitrine le por store_settings_publicas()
-- e a edge function infinitepay-create-link le a mesma linha, entao nada precisa ser
-- republicado. O default da coluna tambem muda, para a loja nascer certa num banco novo.

ALTER TABLE public.store_settings
  ALTER COLUMN credito_parcelas_sem_juros SET DEFAULT 2,
  ALTER COLUMN credito_valor_minimo       SET DEFAULT 200;

DO $jmk$
DECLARE
  v_parcelas integer;
  v_minimo   numeric(10,2);
BEGIN
  UPDATE public.store_settings
     SET credito_parcelas_sem_juros = 2,
         credito_valor_minimo       = 200;

  SELECT credito_parcelas_sem_juros, credito_valor_minimo
    INTO v_parcelas, v_minimo
    FROM public.store_settings
   LIMIT 1;

  IF v_parcelas IS DISTINCT FROM 2 OR v_minimo IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'A regra do credito nao ficou em 2x acima de 200: parcelas=%, minimo=%',
      v_parcelas, v_minimo;
  END IF;

  RAISE NOTICE 'Credito sem juros: ate %x nas compras a partir de R$ %', v_parcelas, v_minimo;
END
$jmk$;
