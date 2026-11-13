-- Segunda metade: fecha a leitura de store_settings.
--
-- APLICAR SÓ DEPOIS de publicar o site que usa store_settings_publicas()
-- (migração 20261113190000). Antes disso, a vitrine no ar ainda lê a tabela
-- direto, e fechar aqui deixaria a loja sem WhatsApp, sem endereço e sem o
-- prazo de reserva.
--
-- A regra antiga era `USING (true)` para anon e authenticated: qualquer pessoa
-- na internet, com a chave pública que vai no próprio JavaScript do site, lia
-- a tabela inteira — inclusive o campo "WhatsApp que recebe o aviso de pedido"
-- (hoje vazio) e as chaves do link de pagamento. Era o aviso "Any signed-in
-- user can read every record in store_settings" do painel do Lovable.
DROP POLICY IF EXISTS "Loja lê configurações públicas" ON public.store_settings;

CREATE POLICY "Equipe lê configurações da loja"
  ON public.store_settings FOR SELECT TO authenticated
  USING (public.is_staff());

DO $confere$
DECLARE
  v_aberta integer;
  v_equipe integer;
BEGIN
  SELECT count(*) INTO v_aberta
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'store_settings'
     AND cmd = 'SELECT' AND COALESCE(qual, 'true') = 'true';
  IF v_aberta <> 0 THEN
    RAISE EXCEPTION 'Ainda existe leitura aberta em store_settings (% regra(s)).', v_aberta;
  END IF;

  SELECT count(*) INTO v_equipe
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'store_settings'
     AND policyname = 'Equipe lê configurações da loja';
  IF v_equipe <> 1 THEN
    RAISE EXCEPTION 'A regra da equipe não ficou de pé.';
  END IF;
END
$confere$;
