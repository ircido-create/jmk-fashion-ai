-- Primeira metade do conserto dos dois avisos de segurança do painel.
--
-- Aqui só se ACRESCENTA: a função que a loja vai passar a usar e o aperto nas
-- figurinhas. A política que hoje deixa o mundo ler store_settings inteira sai
-- na migração seguinte (20261113200000), depois que o site publicado já
-- estiver chamando a função — assim a vitrine não fica nem um minuto sem
-- conseguir ler o WhatsApp e o endereço da loja.

-- ---------------------------------------------------------------- 1) a função
-- A loja precisa de quatro campos: WhatsApp, endereço de retirada, aviso de
-- entrega e prazo de reserva. O resto da tabela (o WhatsApp que recebe o aviso
-- de pedido, as chaves do link de pagamento) é assunto interno e não sai daqui.
CREATE OR REPLACE FUNCTION public.store_settings_publicas()
RETURNS TABLE (
  whatsapp        text,
  pickup_address  text,
  delivery_note   text,
  reserve_hours   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.whatsapp, s.pickup_address, s.delivery_note, s.reserve_hours
    FROM public.store_settings s
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.store_settings_publicas() FROM public;
GRANT EXECUTE ON FUNCTION public.store_settings_publicas() TO anon, authenticated;

-- ------------------------------------------------- 2) figurinhas: só a equipe
-- As regras antigas pediam apenas "estar logado". Conta desativada continua
-- com login válido — a chave "Ativo" tira a pessoa das telas e das regras que
-- olham o papel, mas não apaga o usuário —, então Mônica e Igor, ambos
-- desativados, ainda podiam mandar e apagar arquivo nesse balde, que é
-- público. Agora vale o mesmo critério do resto do sistema: admin ou vendedor.
--
-- A leitura continua pública: as figurinhas são servidas por URL na tela de
-- Conversas, e o balde é público desde que foi criado.
DROP POLICY IF EXISTS "Authenticated upload favorite stickers" ON storage.objects;
CREATE POLICY "Staff upload favorite stickers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'favorite-stickers' AND public.is_staff());

DROP POLICY IF EXISTS "Authenticated delete favorite stickers" ON storage.objects;
CREATE POLICY "Staff delete favorite stickers"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'favorite-stickers' AND public.is_staff());

-- ------------------------------------------------------------- 3) conferência
DO $confere$
DECLARE
  v_funcao  integer;
  v_regras  integer;
  v_frouxa  integer;
BEGIN
  SELECT count(*) INTO v_funcao
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'store_settings_publicas';
  IF v_funcao <> 1 THEN
    RAISE EXCEPTION 'A função store_settings_publicas não foi criada.';
  END IF;

  SELECT count(*) INTO v_regras
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('Staff upload favorite stickers', 'Staff delete favorite stickers');
  IF v_regras <> 2 THEN
    RAISE EXCEPTION 'As regras novas das figurinhas não ficaram de pé (achei %).', v_regras;
  END IF;

  SELECT count(*) INTO v_frouxa
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('Authenticated upload favorite stickers', 'Authenticated delete favorite stickers');
  IF v_frouxa <> 0 THEN
    RAISE EXCEPTION 'As regras frouxas das figurinhas continuam lá (% delas).', v_frouxa;
  END IF;
END
$confere$;
