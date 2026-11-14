-- "Consigo fazer em 3x sem juros para compras acima de R$ 300?" (Jose, 14/11/2026)
--
-- Da. Quem decide quantas parcelas saem sem juros e a partir de que valor e o
-- painel, nao o codigo: assim o Jose muda o limite sem republicar a funcao de
-- pagamento (que custa credito do Lovable).
--
--   credito_parcelas_sem_juros  = ate quantas parcelas a LOJA assume a taxa
--   credito_valor_minimo        = so vale para compras a partir deste valor;
--                                 abaixo dele, so a 1x sai sem juros
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS credito_parcelas_sem_juros integer      NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS credito_valor_minimo       numeric(10,2) NOT NULL DEFAULT 300;

-- A InfinitePay aceita de 1 a 12 parcelas. 1 = ninguem alem da a vista.
ALTER TABLE public.store_settings
  DROP CONSTRAINT IF EXISTS store_settings_credito_parcelas_ok;
ALTER TABLE public.store_settings
  ADD CONSTRAINT store_settings_credito_parcelas_ok
  CHECK (credito_parcelas_sem_juros BETWEEN 1 AND 12);

ALTER TABLE public.store_settings
  DROP CONSTRAINT IF EXISTS store_settings_credito_valor_ok;
ALTER TABLE public.store_settings
  ADD CONSTRAINT store_settings_credito_valor_ok
  CHECK (credito_valor_minimo >= 0);

-- A vitrine precisa dos dois campos para escrever a frase certa para a cliente
-- ("ate 3x sem juros nas compras a partir de R$ 300"). O tipo de retorno muda,
-- entao a funcao e derrubada e recriada; o resto da tabela continua fora.
DROP FUNCTION IF EXISTS public.store_settings_publicas();
CREATE FUNCTION public.store_settings_publicas()
RETURNS TABLE (
  whatsapp                   text,
  pickup_address             text,
  delivery_note              text,
  reserve_hours              integer,
  credito_parcelas_sem_juros integer,
  credito_valor_minimo       numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.whatsapp, s.pickup_address, s.delivery_note, s.reserve_hours,
         s.credito_parcelas_sem_juros, s.credito_valor_minimo
    FROM public.store_settings s
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.store_settings_publicas() FROM public;
GRANT EXECUTE ON FUNCTION public.store_settings_publicas() TO anon, authenticated;

DO $conf$
DECLARE
  v_parcelas integer;
  v_minimo   numeric;
BEGIN
  SELECT credito_parcelas_sem_juros, credito_valor_minimo
    INTO v_parcelas, v_minimo
    FROM public.store_settings LIMIT 1;
  RAISE NOTICE 'Sem juros ate %x nas compras a partir de R$ %', v_parcelas, v_minimo;
END;
$conf$;
