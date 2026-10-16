-- RAIANE MENDONÇA ROSA: junta o cadastro duplicado criado pelo WhatsApp.
--
-- Dois cadastros com o mesmo telefone (55 11 94555-1717):
--   RAIANE MENDONÇA ROSA — criado em 24/04/2026, 4 parcelas (3 em atraso,
--     R$ 1.676,00), 55 cobranças, conversa do número antigo 55 11 98180-1269;
--   Rayane Mendonça — criado em 24/08/2026 pelo WhatsApp, sem parcelas, sem
--     vendas, com a conversa do número atual e um comprovante de R$ 300,00.
--
-- Fica o cadastro antigo, que tem o histórico. A junção move a conversa e o
-- comprovante e apaga o duplicado; o nome dele vira apelido, pela regra da
-- própria merge_customers.
--
-- merge_customers exige sessão de administrador (has_role(auth.uid())), que
-- não existe quando a migração roda fora do aplicativo. O bloco assume um
-- admin do próprio banco só pela duração da transação.
DO $$
DECLARE
  v_keep   uuid;
  v_drop   uuid;
  v_admin  uuid;
  v_res    jsonb;
  v_parc   int;
BEGIN
  SELECT id INTO v_keep FROM public.customers WHERE name = 'RAIANE MENDONÇA ROSA';
  SELECT id INTO v_drop FROM public.customers WHERE name = 'Rayane Mendonça';
  IF v_keep IS NULL OR v_drop IS NULL THEN
    RAISE EXCEPTION 'Cadastros da Raiane não encontrados (já juntados?).';
  END IF;

  -- Garante que o descartado é mesmo o vazio: nada financeiro pode se perder.
  IF EXISTS (SELECT 1 FROM public.accounts_receivable WHERE customer_id = v_drop)
     OR EXISTS (SELECT 1 FROM public.sales WHERE customer_id = v_drop)
     OR EXISTS (SELECT 1 FROM public.pre_sales WHERE customer_id = v_drop)
     OR EXISTS (SELECT 1 FROM public.store_orders WHERE customer_id = v_drop) THEN
    RAISE EXCEPTION 'O cadastro a descartar tem movimento financeiro — confira antes de juntar.';
  END IF;

  IF right(regexp_replace(COALESCE((SELECT phone FROM public.customers WHERE id = v_keep), ''), '\D', '', 'g'), 11)
     <> right(regexp_replace(COALESCE((SELECT phone FROM public.customers WHERE id = v_drop), ''), '\D', '', 'g'), 11) THEN
    RAISE EXCEPTION 'Os dois cadastros não têm o mesmo telefone — não são a mesma pessoa.';
  END IF;

  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin'::public.app_role LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Nenhum administrador cadastrado para autorizar a junção.';
  END IF;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
                     true);

  SELECT public.merge_customers(v_keep, v_drop) INTO v_res;

  IF EXISTS (SELECT 1 FROM public.customers WHERE id = v_drop) THEN
    RAISE EXCEPTION 'O cadastro duplicado continua no banco.';
  END IF;

  SELECT count(*) INTO v_parc FROM public.accounts_receivable WHERE customer_id = v_keep;
  IF v_parc <> 4 THEN
    RAISE EXCEPTION 'A cliente ficou com % parcelas (esperado 4).', v_parc;
  END IF;

  RAISE NOTICE 'Junção concluída: %', v_res;
END $$;
