-- A chave "ativo" da tela de Usuários passa a cortar o acesso de verdade.
--
-- COMO ESTAVA. O botão só gravava profiles.active = false, e nada no sistema
-- lia esse campo: nem o login do Supabase, nem has_role, nem is_staff — que é
-- quem manda em todas as regras de acesso. Quem fosse "desativado" continuava
-- entrando e vendo tudo. Quem desligasse a chave ficava achando que tinha
-- cortado o acesso.
--
-- COMO FICA. Desligar a chave passa a fazer, sozinho, as mesmas quatro coisas
-- que foram feitas à mão na conta do Igor em 11/11/2026:
--   1. has_role passa a exigir profiles.active — sem isso, nenhuma regra do
--      banco reconhece a pessoa como admin ou vendedora. Vale na hora, mesmo
--      com o navegador dela aberto.
--   2. o login passa a ser recusado (banned_until em auth.users);
--   3. a sessão aberta é derrubada (auth.sessions e auth.refresh_tokens);
--   4. religar a chave desfaz tudo isso.
--
-- E TRÊS TRAVAS, porque agora a chave tem poder:
--   - só administrador pode mexer nela. Sem isso, a pessoa desativada que ainda
--     tivesse o aplicativo aberto poderia se reativar: a regra de profiles
--     deixa cada um alterar o próprio cadastro.
--   - ninguém se desativa (não dá para se trancar para fora);
--   - não dá para desativar o último administrador ativo.
-- Comando rodado direto no banco (como este aqui) não passa pelas travas: ali
-- quem está no teclado já tem a chave da casa.
--
-- Todo mundo tem cadastro em profiles — ele é criado pelo gatilho
-- on_auth_user_created junto com a conta —, então ninguém perde acesso por
-- falta de linha.

-- ---------- 1. o papel só vale para quem está ativo ----------
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND active
  )
$$;

-- ---------- 2. quem pode mexer na chave ----------
CREATE OR REPLACE FUNCTION public.profiles_guard_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_quem uuid := auth.uid();
BEGIN
  IF NEW.active IS NOT DISTINCT FROM OLD.active THEN
    RETURN NEW;
  END IF;

  -- direto no banco (sem usuário logado) não há o que checar
  IF v_quem IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_quem AND role = 'admin')
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_quem AND active) THEN
    RAISE EXCEPTION 'Só um administrador pode ativar ou desativar o acesso de alguém.';
  END IF;

  IF NOT NEW.active AND NEW.id = v_quem THEN
    RAISE EXCEPTION 'Você não pode desativar o seu próprio acesso.';
  END IF;

  IF NOT NEW.active AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role = 'admin') THEN
    IF (SELECT count(*) FROM public.user_roles ur
          JOIN public.profiles p ON p.id = ur.user_id
         WHERE ur.role = 'admin' AND p.active AND ur.user_id <> NEW.id) < 1 THEN
      RAISE EXCEPTION 'Este é o último administrador ativo — desativá-lo trancaria todo mundo para fora.';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_profiles_guard_active ON public.profiles;
CREATE TRIGGER trg_profiles_guard_active
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_active();

-- ---------- 3. a chave bloqueia (ou devolve) o login ----------
CREATE OR REPLACE FUNCTION public.profiles_apply_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.active IS NOT DISTINCT FROM OLD.active THEN
    RETURN NULL;
  END IF;

  IF NOT NEW.active THEN
    UPDATE auth.users
       SET banned_until = timestamptz '2099-12-31 00:00:00+00', updated_at = now()
     WHERE id = NEW.id;
    DELETE FROM auth.refresh_tokens WHERE user_id::text = NEW.id::text;
    DELETE FROM auth.sessions WHERE user_id = NEW.id;
  ELSE
    UPDATE auth.users
       SET banned_until = NULL, updated_at = now()
     WHERE id = NEW.id;
  END IF;

  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS trg_profiles_apply_active ON public.profiles;
CREATE TRIGGER trg_profiles_apply_active
  AFTER UPDATE OF active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_apply_active();

-- ---------- 4. põe o que já existe em dia ----------
-- Conta ativa não pode estar bloqueada por engano, e conta inativa não pode
-- continuar entrando. Hoje só o Igor está inativo, e já está bloqueado.
UPDATE auth.users u
   SET banned_until = NULL, updated_at = now()
  FROM public.profiles p
 WHERE p.id = u.id AND p.active AND u.banned_until IS NOT NULL;

UPDATE auth.users u
   SET banned_until = timestamptz '2099-12-31 00:00:00+00', updated_at = now()
  FROM public.profiles p
 WHERE p.id = u.id AND NOT p.active AND coalesce(u.banned_until, '-infinity') < now();

-- ---------- conferência ----------
DO $confere$
DECLARE
  v_admin uuid;
  v_igor  uuid;
BEGIN
  SELECT u.id INTO v_admin FROM auth.users u WHERE u.email = 'ircido@gmail.com';
  SELECT u.id INTO v_igor  FROM auth.users u WHERE u.email = 'igor.nathan@gmail.com';

  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'O administrador da loja deixou de ser reconhecido — nada feito.';
  END IF;

  IF v_igor IS NOT NULL AND public.has_role(v_igor, 'admin') THEN
    RAISE EXCEPTION 'A conta desativada ainda é reconhecida como administradora.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
     WHERE p.active AND u.banned_until > now()
  ) THEN
    RAISE EXCEPTION 'Sobrou conta ativa com o login bloqueado.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
     WHERE NOT p.active AND coalesce(u.banned_until, '-infinity') < now()
  ) THEN
    RAISE EXCEPTION 'Sobrou conta inativa que ainda consegue entrar.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin' AND p.active
  ) THEN
    RAISE EXCEPTION 'O sistema ficou sem administrador ativo.';
  END IF;
END
$confere$;
