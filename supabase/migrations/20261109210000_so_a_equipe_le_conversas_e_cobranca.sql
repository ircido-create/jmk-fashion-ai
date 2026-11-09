-- Conversas, telefones e cobrança passam a exigir gente da loja.
--
-- A varredura de segurança do Lovable apontou 12 tabelas cujas regras deixavam
-- "qualquer usuário logado" entrar. Conferido no banco em 09/11/2026, com um
-- teste que se desfaz no fim: uma conta recém-criada, sem papel nenhum, lia
-- 69.401 mensagens de WhatsApp, 575 conversas (com nome e telefone das
-- clientes) e 5.232 registros de cobrança. O cadastro de clientes e as vendas
-- já estavam protegidos — liam 0 linhas.
--
-- Como o cadastro de contas do Supabase estava aberto e a chave pública do app
-- vai no JavaScript do site, qualquer pessoa podia criar uma conta e ler isso.
-- O cadastro foi fechado junto com esta migração; aqui fica a outra metade:
-- cada uma dessas regras passa a exigir papel de admin ou vendedor, como já
-- acontece no resto do sistema.
--
-- As três contas que existem hoje (2 admin + 1 vendedor) têm papel, então
-- ninguém da loja perde acesso. As edge functions usam a chave de serviço e
-- não passam por estas regras.
--
-- store_settings continua legível sem login de propósito: é o que a loja
-- virtual lê para mostrar o WhatsApp e o endereço de retirada.

-- Quem é da loja. Fica numa função para a regra ser a mesma em todo lugar.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'vendedor'::app_role)
$$;

REVOKE ALL ON FUNCTION public.is_staff() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- ---------- conversas e mensagens ----------
DROP POLICY IF EXISTS "Authenticated view conversations" ON public.whatsapp_conversations;
CREATE POLICY "Equipe ve conversas" ON public.whatsapp_conversations
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Authenticated view messages" ON public.whatsapp_messages;
CREATE POLICY "Equipe ve mensagens" ON public.whatsapp_messages
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "auth read" ON public.status_reaction_sent;
CREATE POLICY "Equipe le status_reaction_sent" ON public.status_reaction_sent
  FOR SELECT TO authenticated USING (public.is_staff());

-- ---------- cobrança ----------
DROP POLICY IF EXISTS "Authenticated view dunning_logs" ON public.dunning_logs;
CREATE POLICY "Equipe ve dunning_logs" ON public.dunning_logs
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Autenticados podem ver rodadas de cobranca" ON public.dunning_runs;
CREATE POLICY "Equipe ve rodadas de cobranca" ON public.dunning_runs
  FOR SELECT TO authenticated USING (public.is_staff());

-- ---------- IA ----------
DROP POLICY IF EXISTS "Authenticated read ai_settings" ON public.ai_settings;
CREATE POLICY "Equipe le ai_settings" ON public.ai_settings
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Authenticated read ai_blocked_contacts" ON public.ai_blocked_contacts;
CREATE POLICY "Equipe le ai_blocked_contacts" ON public.ai_blocked_contacts
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "voice_clones_select_authenticated" ON public.voice_clones;
CREATE POLICY "Equipe le voice_clones" ON public.voice_clones
  FOR SELECT TO authenticated USING (public.is_staff());

-- ---------- romaneios e junção de cadastros ----------
DROP POLICY IF EXISTS "auth read imported_romaneios" ON public.imported_romaneios;
CREATE POLICY "Equipe le imported_romaneios" ON public.imported_romaneios
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "auth insert imported_romaneios" ON public.imported_romaneios;
CREATE POLICY "Equipe grava imported_romaneios" ON public.imported_romaneios
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "auth read merge ignored" ON public.customer_merge_ignored;
CREATE POLICY "Equipe le merge ignored" ON public.customer_merge_ignored
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "auth insert merge ignored" ON public.customer_merge_ignored;
CREATE POLICY "Equipe grava merge ignored" ON public.customer_merge_ignored
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "auth delete merge ignored" ON public.customer_merge_ignored;
CREATE POLICY "Equipe apaga merge ignored" ON public.customer_merge_ignored
  FOR DELETE TO authenticated USING (public.is_staff());

-- ---------- figurinhas ----------
DROP POLICY IF EXISTS "Authenticated read favorite stickers" ON public.favorite_stickers;
CREATE POLICY "Equipe le favorite stickers" ON public.favorite_stickers
  FOR SELECT TO authenticated USING (public.is_staff());

-- ---------- conferência ----------
-- Se sobrou alguma regra sem restrição nessas tabelas, nada disso vale.
DO $conferencia$
DECLARE
  v_frouxas text;
BEGIN
  SELECT string_agg(c.relname || '.' || p.polname, ', ')
    INTO v_frouxas
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('whatsapp_conversations','whatsapp_messages','status_reaction_sent',
                       'dunning_logs','dunning_runs','ai_settings','ai_blocked_contacts',
                       'voice_clones','imported_romaneios','customer_merge_ignored',
                       'favorite_stickers')
     AND coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') = 'true'
     AND coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'true') = 'true';

  IF v_frouxas IS NOT NULL THEN
    RAISE EXCEPTION 'Ainda há regras sem restrição: %', v_frouxas;
  END IF;
END
$conferencia$;
