-- ELZIRENE PEREIRA DA SILVA PESSOA ("Elza"): desfaz uma baixa automática
-- indevida e lança o Pix que ela pagou de verdade hoje.
--
-- O QUE DEU ERRADO. Hoje, 09/11/2026, às 12:51, ela mandou uma imagem no
-- WhatsApp. A leitura automática entendeu "Pix de R$ 150,00 para JASPRINT",
-- deu baixa sozinha e reduziu a parcela 1/4 de R$ 224,00 para R$ 74,00. Um
-- minuto depois ela apagou a mensagem e mandou áudio: "só me confirma, o seu
-- Pix é esse daí mesmo, né? Faz dias que eu não faço Pix pra irmã". Ou seja,
-- ela ainda não tinha pagado — mandou um comprovante velho só para conferir
-- a chave. A imagem continua guardada no bucket whatsapp-media e foi aberta
-- para conferência: "Pix concluído — 13/06/2026 14:07:49 — Valor: R$ 150,00".
-- Comprovante de cinco meses atrás, de uma compra que não é esta (a carteira
-- atual foi lançada em 06/10/2026). A baixa não vale.
--
-- O QUE ELA PAGOU MESMO. Às 15:43:52 de hoje, Pix de R$ 225,00 para JASPRINT,
-- CNPJ 55.793.541/0001-06, Itaú — a chave da JMK. Mandou o comprovante às
-- 15:53 com "Segue o comprovante de pagamento". Caiu na queda do BubbleWhats
-- (das 13:46 às 17:18), então não entrou no sistema.
--
-- COMO FICA. A parcela 1/4 volta a R$ 224,00 e é quitada com R$ 224,00 dos
-- R$ 225,00. O R$ 1,00 que sobrou entra como pagamento parcial da 2/4, que
-- passa a R$ 223,00 — é o mesmo jeito que o sistema trata pagamento parcial.
-- O comprovante de junho fica marcado como 'ignorado', com a explicação, em
-- vez de ser apagado.
--
-- Em aberto depois disto: R$ 671,00 em três parcelas.
DO $elza$
DECLARE
  v_cli     uuid;
  v_antes   numeric;
  v_qtd     int;
  v_p1      uuid;
  v_p2      uuid;
  v_antigo  uuid;
  v_prova   uuid;
  v_depois  numeric;
  v_pago    numeric;
BEGIN
  SELECT id INTO v_cli FROM public.customers
   WHERE name = 'ELZIRENE PEREIRA DA SILVA PESSOA';
  IF v_cli IS NULL THEN
    RAISE EXCEPTION 'Não achei a cliente ELZIRENE PEREIRA DA SILVA PESSOA.';
  END IF;

  SELECT coalesce(sum(amount), 0), count(*) INTO v_antes, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_antes <> 746.00 OR v_qtd <> 4 THEN
    RAISE EXCEPTION 'A conta mudou desde a conferência: % parcelas somando R$ % (esperado 4 e R$ 746,00).', v_qtd, v_antes;
  END IF;

  SELECT id INTO v_p1 FROM public.accounts_receivable
   WHERE customer_id = v_cli AND due_date = DATE '2026-11-10' AND amount = 74.00;
  SELECT id INTO v_p2 FROM public.accounts_receivable
   WHERE customer_id = v_cli AND due_date = DATE '2026-12-10' AND amount = 224.00;

  IF v_p1 IS NULL OR v_p2 IS NULL THEN
    RAISE EXCEPTION 'Não achei as parcelas 1/4 (10/11, R$ 74,00) e 2/4 (10/12, R$ 224,00).';
  END IF;

  -- 1) a baixa indevida sai
  SELECT pp.id INTO v_antigo
    FROM public.payment_proofs pp
   WHERE pp.customer_id = v_cli AND pp.ai_amount = 150
     AND pp.created_at >= DATE '2026-11-09' AND pp.created_at < DATE '2026-11-10';

  IF v_antigo IS NULL THEN
    RAISE EXCEPTION 'Não achei o comprovante de R$ 150,00 lido hoje.';
  END IF;

  DELETE FROM public.receivable_payments
   WHERE receivable_id = v_p1 AND proof_id = v_antigo AND amount_paid = 150.00;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não achei a baixa de R$ 150,00 para apagar.';
  END IF;

  UPDATE public.accounts_receivable
     SET amount = 224.00, status = 'pendente', paid_at = NULL
   WHERE id = v_p1;

  UPDATE public.payment_proofs
     SET settlement_status = 'ignorado',
         settled_at = NULL,
         settlement_note = 'Baixa desfeita em 09/11/2026: o comprovante é de 13/06/2026 14:07:49, mandado pela cliente só para conferir a chave Pix (ela apagou a mensagem logo depois). Não é pagamento desta carteira, lançada em 06/10/2026.'
   WHERE id = v_antigo;

  -- 2) o Pix de verdade, de hoje
  INSERT INTO public.payment_proofs
         (customer_id, storage_path, source, settlement_status, payment_date, description)
  VALUES (v_cli, '', 'manual', 'manual', TIMESTAMPTZ '2026-11-09 15:43:52-03',
          'Recebimento manual — ELZIRENE PEREIRA DA SILVA PESSOA — Pix de R$ 225,00 em 09/11/2026 15:43:52, recebedor JASPRINT, CNPJ 55.793.541/0001-06, Itaú (chave da JMK). Comprovante conferido no WhatsApp Web; chegou durante a queda do BubbleWhats, por isso não há arquivo guardado. R$ 224,00 quitam a parcela 1/4 e R$ 1,00 abatem a 2/4.')
  RETURNING id INTO v_prova;

  INSERT INTO public.receivable_payments (receivable_id, proof_id, amount_paid, created_at)
  VALUES (v_p1, v_prova, 224.00, TIMESTAMPTZ '2026-11-09 15:43:52-03'),
         (v_p2, v_prova,   1.00, TIMESTAMPTZ '2026-11-09 15:43:52-03');

  UPDATE public.accounts_receivable
     SET status = 'pago', paid_at = TIMESTAMPTZ '2026-11-09 15:43:52-03'
   WHERE id = v_p1;

  UPDATE public.accounts_receivable
     SET amount = 223.00
   WHERE id = v_p2;

  -- 3) conferência
  SELECT coalesce(sum(amount), 0), count(*) INTO v_depois, v_qtd
    FROM public.accounts_receivable
   WHERE customer_id = v_cli AND status IN ('pendente', 'vencido');

  IF v_depois <> 671.00 OR v_qtd <> 3 THEN
    RAISE EXCEPTION 'Depois de tudo sobraram % parcelas somando R$ % (esperado 3 e R$ 671,00).', v_qtd, v_depois;
  END IF;

  SELECT coalesce(sum(amount_paid), 0) INTO v_pago
    FROM public.receivable_payments rp
    JOIN public.accounts_receivable ar ON ar.id = rp.receivable_id
   WHERE ar.customer_id = v_cli;

  IF v_pago <> 225.00 THEN
    RAISE EXCEPTION 'A conta ficou com R$ % lançados no total (esperado R$ 225,00).', v_pago;
  END IF;
END
$elza$;
