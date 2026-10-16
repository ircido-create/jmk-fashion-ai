-- TAINA DIAS DE SOUSA: estorno do Pix da irmã e venda de 16/09 em 6 parcelas.
--
-- A venda de 16/09/2026 (R$ 1.050,00 — Vestido 7520 Aurora, Vestido 5705
-- Taylane e Conjunto LP Rosa) entrou como parcela única vencendo 10/10/2026 e
-- recebeu duas baixas parciais:
--   30/09  R$ 260,00  Pix de TAIS MARIA DIAS DE SOUSA (cadastro próprio)
--   10/10  R$ 175,00  Pix da própria TAINA
-- restando R$ 615,00. A loja confirmou que os R$ 260,00 eram pagamento da
-- TAIS e não deviam ter abatido esta conta.
--
-- O que esta migração faz:
--   1. desfaz a baixa dos R$ 260,00 e devolve o comprovante para a fila
--      ('pendente'), sem apagá-lo — reverse_payment_proof não serve aqui
--      porque ela exclui o comprovante, e este é um pagamento real da TAIS;
--   2. transforma a parcela de 10/10 na 1ª de 6 de R$ 175,00, já quitada pelo
--      Pix de 10/10 (o vínculo do pagamento continua nela);
--   3. cria as 5 parcelas restantes de R$ 175,00, combinadas com a cliente:
--      10/11/2026, 10/12/2026, 10/01/2027, 10/02/2027 e 10/03/2027.
--
-- 6 × 175 = 1.050,00, o valor da venda. Em aberto ficam R$ 875,00.
--
-- O bloco confere tudo antes de escrever e aborta inteiro (RAISE) se o banco
-- estiver diferente do esperado — rodar duas vezes não duplica parcelas.
DO $$
DECLARE
  v_cliente  uuid;
  v_parcela  uuid;
  v_sale     uuid;
  v_proof    uuid;
  v_pago_em  timestamptz;
  v_saldo    numeric;
  v_total    numeric;
  v_datas    date[] := ARRAY['2026-11-10','2026-12-10','2027-01-10','2027-02-10','2027-03-10']::date[];
  v_i        int;
BEGIN
  SELECT id INTO v_cliente FROM public.customers WHERE name = 'TAINA DIAS DE SOUSA';
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'Cliente TAINA DIAS DE SOUSA não encontrada.';
  END IF;

  SELECT ar.id, ar.sale_id, ar.amount
    INTO v_parcela, v_sale, v_saldo
    FROM public.accounts_receivable ar
   WHERE ar.customer_id = v_cliente
     AND ar.due_date = DATE '2026-10-10'
     AND ar.sale_id IS NOT NULL;

  IF v_parcela IS NULL THEN
    RAISE EXCEPTION 'Parcela de 10/10/2026 da venda de 16/09 não encontrada.';
  END IF;
  IF v_saldo <> 615.00 THEN
    RAISE EXCEPTION 'A parcela está com R$ % (esperado R$ 615,00). Alguém mexeu na conta depois do levantamento — confira antes de aplicar.', v_saldo;
  END IF;

  -- 1) Estorno do Pix de R$ 260,00 da TAIS.
  SELECT rp.proof_id INTO v_proof
    FROM public.receivable_payments rp
   WHERE rp.receivable_id = v_parcela AND rp.amount_paid = 260;
  IF v_proof IS NULL THEN
    RAISE EXCEPTION 'Baixa de R$ 260,00 não encontrada nesta parcela.';
  END IF;

  DELETE FROM public.receivable_payments
   WHERE receivable_id = v_parcela AND proof_id = v_proof;

  UPDATE public.payment_proofs
     SET settlement_status = 'pendente',
         settled_at        = NULL,
         settlement_note   = 'Estornado em 15/10/2026: pagamento de TAIS MARIA DIAS DE SOUSA que estava baixado na conta de TAINA DIAS DE SOUSA.'
   WHERE id = v_proof;

  -- 2) A parcela de 10/10 vira a 1/6, quitada pelo Pix de R$ 175,00.
  SELECT rp.created_at INTO v_pago_em
    FROM public.receivable_payments rp
   WHERE rp.receivable_id = v_parcela AND rp.amount_paid = 175;
  IF v_pago_em IS NULL THEN
    RAISE EXCEPTION 'Baixa de R$ 175,00 (Pix de 10/10) não encontrada nesta parcela.';
  END IF;

  UPDATE public.accounts_receivable
     SET amount      = 175.00,
         status      = 'pago',
         paid_at     = v_pago_em,
         description = 'Carteira (1/6) — 3 item(ns)'
   WHERE id = v_parcela;

  -- 3) As cinco parcelas combinadas.
  IF EXISTS (
    SELECT 1 FROM public.accounts_receivable
     WHERE customer_id = v_cliente AND due_date = ANY(v_datas)
  ) THEN
    RAISE EXCEPTION 'Já existem parcelas nessas datas para a cliente — migração aplicada antes?';
  END IF;

  FOR v_i IN 1..5 LOOP
    INSERT INTO public.accounts_receivable
      (customer_id, sale_id, amount, due_date, description, status)
    VALUES
      (v_cliente, v_sale, 175.00, v_datas[v_i],
       'Carteira (' || (v_i + 1) || '/6) — 3 item(ns)', 'pendente');
  END LOOP;

  -- Conferência final: as parcelas têm de somar o valor da venda.
  SELECT sum(ar.amount) INTO v_total
    FROM public.accounts_receivable ar WHERE ar.sale_id = v_sale;
  IF v_total <> 1050.00 THEN
    RAISE EXCEPTION 'As parcelas somam R$ % e a venda é de R$ 1.050,00.', v_total;
  END IF;
END $$;
