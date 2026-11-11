-- Desativa a conta igor.nathan@gmail.com.
--
-- POR QUÊ. Em 11/11/2026 o José pediu. Era o segundo administrador do sistema,
-- criada em 08/07/2026 e sem nenhum acesso desde 13/07 — 121 dias parada, com
-- poder total: lê toda a base de clientes, as conversas de WhatsApp e o
-- financeiro, e pode criar outras contas. Porta aberta que ninguém usa.
--
-- POR QUE NÃO PELO BOTÃO DA TELA. A chave "ativo" da tela de Usuários só grava
-- profiles.active = false, e nada no sistema consulta esse campo: nem o login,
-- nem has_role, nem is_staff (que é quem manda nas regras de acesso). Desligar
-- por lá deixaria a conta entrando normalmente. Por isso aqui vão as quatro
-- camadas de verdade.
--
-- NADA É APAGADO: a conta continua existindo e tudo isto se desfaz se um dia
-- ele voltar — tirar o banned_until, devolver o papel e religar o profiles.
DO $igor$
DECLARE
  v_id       uuid;
  v_admins   int;
  v_sessoes  int;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE email = 'igor.nathan@gmail.com';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Não achei a conta igor.nathan@gmail.com.';
  END IF;

  -- não pode sobrar o sistema sem administrador
  SELECT count(*) INTO v_admins
    FROM public.user_roles WHERE role = 'admin' AND user_id <> v_id;
  IF v_admins < 1 THEN
    RAISE EXCEPTION 'Esta é a única conta de administrador — desativá-la trancaria todo mundo para fora.';
  END IF;

  -- 1. o login passa a ser recusado (e a renovação de sessão também)
  UPDATE auth.users
     SET banned_until = timestamptz '2099-12-31 00:00:00+00',
         updated_at = now()
   WHERE id = v_id;

  -- 2. sem papel, mesmo entrando não enxergaria nada
  DELETE FROM public.user_roles WHERE user_id = v_id;

  -- 3. a tela de Usuários passa a mostrar a conta como inativa
  UPDATE public.profiles SET active = false, updated_at = now() WHERE id = v_id;

  -- 4. derruba sessão antiga que ainda estivesse de pé
  SELECT count(*) INTO v_sessoes FROM auth.sessions WHERE user_id = v_id;
  DELETE FROM auth.refresh_tokens WHERE user_id::text = v_id::text;
  DELETE FROM auth.sessions WHERE user_id = v_id;
  RAISE NOTICE 'Sessões derrubadas: %', v_sessoes;

  -- ---------- conferência ----------
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_id AND banned_until > now()) THEN
    RAISE EXCEPTION 'A conta continua podendo entrar.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_id) THEN
    RAISE EXCEPTION 'A conta continua com papel no sistema.';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_id) THEN
    RAISE EXCEPTION 'Sobrou sessão aberta da conta.';
  END IF;
  IF (SELECT count(*) FROM public.user_roles WHERE role = 'admin') < 1 THEN
    RAISE EXCEPTION 'O sistema ficou sem administrador.';
  END IF;
END
$igor$;
