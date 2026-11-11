-- Desativa a conta monica@jasprint.com.br, a pedido do José em 11/11/2026.
--
-- POR QUÊ. Conta de vendedora criada em 11/05/2026, sem nenhum acesso desde
-- 02/07 — 132 dias. A sessão que aparecia aberta era fantasma: um celular
-- Android entrou em 02/07 às 19:17, renovou pela última vez em 03/07 às 04:50 e
-- nunca mais. Ninguém perde acesso hoje com isto.
--
-- COMO. Pela chave "Ativo", que desde a migração 20261112010000 faz sozinha o
-- serviço inteiro: recusa o login, derruba a sessão e tira o reconhecimento do
-- papel. É exatamente o que acontece quando alguém desliga a chave na tela.
--
-- O PAPEL DE VENDEDORA FICA. Diferente do que foi feito na conta do Igor (que
-- precisou ser desativada à mão, antes de a chave funcionar), aqui não apago
-- nada: com a chave desligada o papel não vale, e religá-la devolve o acesso
-- da Mônica em um clique, sem precisar lembrar qual era o papel dela.
DO $monica$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE email = 'monica@jasprint.com.br';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Não achei a conta monica@jasprint.com.br.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Esta conta é de administrador — confira antes de desativar.';
  END IF;

  UPDATE public.profiles SET active = false, updated_at = now() WHERE id = v_id;

  -- ---------- conferência ----------
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_id AND banned_until > now()) THEN
    RAISE EXCEPTION 'A conta continua podendo entrar.';
  END IF;
  IF public.has_role(v_id, 'vendedor') THEN
    RAISE EXCEPTION 'O sistema ainda reconhece a conta como vendedora.';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_id) THEN
    RAISE EXCEPTION 'Sobrou sessão aberta da conta.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin' AND p.active
  ) THEN
    RAISE EXCEPTION 'O sistema ficou sem administrador ativo.';
  END IF;
END
$monica$;
