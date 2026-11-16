-- Decisao do Jose em 16/11/2026, pela tela de Pedidos da Loja:
--   * o link de pagamento passa a valer 12 horas (estava 72);
--   * o credito sem juros volta a 3 parcelas a partir de R$ 300 (estava 2 a partir de 200).
-- A vitrine e a edge function infinitepay-create-link leem store_settings, entao
-- nada precisa ser republicado. Os defaults acompanham os valores novos.

ALTER TABLE public.store_settings
  ALTER COLUMN payment_link_hours         SET DEFAULT 12,
  ALTER COLUMN credito_parcelas_sem_juros SET DEFAULT 3,
  ALTER COLUMN credito_valor_minimo       SET DEFAULT 300;

DO $jmk$
DECLARE
  v_horas    integer;
  v_parcelas integer;
  v_minimo   numeric(10,2);
BEGIN
  UPDATE public.store_settings
     SET payment_link_hours         = 12,
         credito_parcelas_sem_juros = 3,
         credito_valor_minimo       = 300;

  SELECT payment_link_hours, credito_parcelas_sem_juros, credito_valor_minimo
    INTO v_horas, v_parcelas, v_minimo
    FROM public.store_settings
   LIMIT 1;

  IF v_horas    IS DISTINCT FROM 12
  OR v_parcelas IS DISTINCT FROM 3
  OR v_minimo   IS DISTINCT FROM 300 THEN
    RAISE EXCEPTION 'A configuracao nao ficou como pedido: horas=%, parcelas=%, minimo=%',
      v_horas, v_parcelas, v_minimo;
  END IF;

  RAISE NOTICE 'Link vale % h; credito ate %x a partir de R$ %.', v_horas, v_parcelas, v_minimo;
END
$jmk$;
