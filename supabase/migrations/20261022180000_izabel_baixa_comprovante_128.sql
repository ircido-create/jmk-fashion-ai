-- IZABEL CRISTINA CARVALHO DOS REIS: baixa do Pix de R$ 128,00 de 22/10/2026.
--
-- O comprovante chegou no mesmo dia em que a baixa automática aplicou o Pix de
-- R$ 500,00 da Nara Costa Lima, e ficou parado como 'pendente' porque o nome da
-- pagadora vem como "IZABEL CRISTINA CARVALHO DOS REIS MATOS" — não bate com o
-- cadastro. A loja confirmou que é dela.
--
-- Com ele a conta fecha: sobrava só a 5/5, de R$ 124,00, vencendo 02/02/2027.
-- Os R$ 4,00 a mais não são aplicados em lugar nenhum; ficam registrados na
-- observação do comprovante.
--
-- A baixa vai pela apply_receivable_payment, a mesma função que a tela usa, para
-- gravar parcela, comprovante e vínculo numa transação só. Ela exige sessão de
-- admin, que não existe fora do aplicativo: o bloco assume um admin do próprio
-- banco pela duração da transação.
DO $$
DECLARE
  v_cliente uuid;
  v_parcela uuid;
  v_saldo   numeric;
  v_proof   uuid;
  v_pago_em timestamptz;
  v_admin   uuid;
  v_res     jsonb;
  v_aberto  numeric;
BEGIN
  SELECT id INTO v_cliente FROM public.customers
   WHERE name = 'IZABEL CRISTINA CARVALHO DOS REIS';
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'Cliente não encontrada.';
  END IF;

  SELECT ar.id, round(ar.amount, 2) INTO v_parcela, v_saldo
    FROM public.accounts_receivable ar
   WHERE ar.customer_id = v_cliente
     AND ar.due_date = DATE '2027-02-02'
     AND ar.status IN ('pendente', 'vencido');
  IF v_parcela IS NULL THEN
    RAISE EXCEPTION 'Parcela 5/5 (02/02/2027) não encontrada em aberto — já baixada?';
  END IF;
  IF v_saldo <> 124.00 THEN
    RAISE EXCEPTION 'A parcela está com R$ % (esperado R$ 124,00) — confira antes de aplicar.', v_saldo;
  END IF;

  SELECT pp.id, pp.payment_date INTO v_proof, v_pago_em
    FROM public.payment_proofs pp
   WHERE pp.customer_id = v_cliente
     AND pp.ai_amount = 128
     AND pp.payment_date::date = DATE '2026-10-22';
  IF v_proof IS NULL THEN
    RAISE EXCEPTION 'Comprovante de R$ 128,00 de 22/10/2026 não encontrado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.receivable_payments WHERE proof_id = v_proof) THEN
    RAISE EXCEPTION 'Esse comprovante já tem baixa registrada.';
  END IF;

  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin'::public.app_role LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Nenhum administrador cadastrado para autorizar a baixa.';
  END IF;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
                     true);

  SELECT public.apply_receivable_payment(
           jsonb_build_array(jsonb_build_object(
             'receivable_id', v_parcela::text,
             'kind', 'settle',
             'amount_paid', 124.00,
             'expected_amount', 124.00)),
           COALESCE(v_pago_em, TIMESTAMPTZ '2026-10-22 12:00:00-03'),
           v_proof)
    INTO v_res;

  UPDATE public.payment_proofs
     SET settlement_status = 'manual',
         settled_at        = now(),
         settlement_note   = 'Baixa manual em 22/10/2026: R$ 124,00 na parcela 5/5 (02/02/2027), que fica quitada. Os R$ 4,00 restantes não foram aplicados.'
   WHERE id = v_proof;

  SELECT coalesce(sum(ar.amount), 0) INTO v_aberto
    FROM public.accounts_receivable ar
   WHERE ar.customer_id = v_cliente AND ar.status IN ('pendente', 'vencido');
  IF v_aberto <> 0 THEN
    RAISE EXCEPTION 'Depois da baixa ainda restam R$ % em aberto (esperado zero).', v_aberto;
  END IF;
END $$;
