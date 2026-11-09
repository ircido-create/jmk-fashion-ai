-- SANDRA FERREIRA DOS SANTOS FRANCO ("Sandra Prima"): duas parcelas marcadas
-- para 2027 e a cobrança diária de algo que ela já combinou.
--
-- Em 03/11/2026 as quatro parcelas da compra de 30/09 foram editadas à mão e
-- as duas últimas saíram com o ano errado: 24/11/2027 e 24/12/2027, quando a
-- sequência é 24/09/2026, 24/10/2026, 24/11/2026 e 24/12/2026. São R$ 710,00
-- que só voltariam a aparecer na cobrança daqui a um ano.
--
-- Em 06/11, no WhatsApp, ela avisou: "até a semana que vem eu te pago, a
-- segunda parcela... tô esperando entrar o dia do aluguel, mas só entra dia
-- 10". Até lá a cobrança automática manda lembrete todo dia. A pausa no banco
-- é sem data (só ligado/desligado), então o motivo fica no cadastro e alguém
-- precisa religar a partir de 12/11.
--
-- O saldo não muda: R$ 1.110,00 antes e depois.
DO $sandra$
DECLARE
  v_cliente uuid := '100241ee-e4c0-4cb7-bcd9-8eaa6da6014c';
  v_p3      uuid := '139a2533-69bb-4a1e-aaac-214f85554d53';  -- Carteira (3/4)
  v_p4      uuid := '811754ea-58de-4caa-9221-91673d1dad85';  -- Carteira (4/4)
  v_antes   numeric;
  v_depois  numeric;
  v_2027    int;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO v_antes
    FROM public.accounts_receivable
   WHERE customer_id = v_cliente AND status IN ('pendente', 'vencido');

  IF v_antes <> 1110.00 THEN
    RAISE EXCEPTION 'O saldo em aberto mudou desde a conferência: R$ % (esperado R$ 1.110,00).', v_antes;
  END IF;

  -- 1) as duas parcelas voltam para 2026
  UPDATE public.accounts_receivable
     SET due_date = DATE '2026-11-24'
   WHERE id = v_p3 AND status IN ('pendente', 'vencido') AND due_date = DATE '2027-11-24';

  UPDATE public.accounts_receivable
     SET due_date = DATE '2026-12-24'
   WHERE id = v_p4 AND status IN ('pendente', 'vencido') AND due_date = DATE '2027-12-24';

  -- 2) cobrança pausada até ela pagar, como combinado
  UPDATE public.customers
     SET dunning_paused = true,
         dunning_pause_note = 'Pausada até 11/11/2026 — em 06/11 avisou no WhatsApp que paga a segunda parcela quando entrar o aluguel, dia 10. Religar a cobrança a partir de 12/11.',
         updated_at = now()
   WHERE id = v_cliente;

  -- 3) conferência
  SELECT coalesce(sum(amount), 0), count(*) FILTER (WHERE due_date >= DATE '2027-01-01')
    INTO v_depois, v_2027
    FROM public.accounts_receivable
   WHERE customer_id = v_cliente AND status IN ('pendente', 'vencido');

  IF v_depois <> 1110.00 THEN
    RAISE EXCEPTION 'A conta não fecha: R$ % em aberto (esperado R$ 1.110,00).', v_depois;
  END IF;
  IF v_2027 <> 0 THEN
    RAISE EXCEPTION 'Ainda sobraram % parcelas vencendo em 2027.', v_2027;
  END IF;
END
$sandra$;
