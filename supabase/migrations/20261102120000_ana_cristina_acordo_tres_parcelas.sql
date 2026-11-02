-- Acordo refeito com ANA CRISTINA PEREIRA ("Ana Vilma") em 02/11/2026.
--
-- Ela tinha R$ 615,00 espalhados em 7 parcelas de três carteiras diferentes,
-- indo até fevereiro de 2027, e o resto de uma parcela já vencida. A loja
-- acertou com ela juntar tudo em três:
--
--   30/10/2026  R$ 215,00
--   15/11/2026  R$ 215,00
--   30/11/2026  R$ 185,00
--
-- O total não muda: R$ 615,00 antes e depois. O que entra numa parcela sai da
-- outra, e a conferência no fim recusa a migração se a soma sair diferente.
--
-- As quatro parcelas que saem viram 'cancelado' em vez de serem apagadas: o
-- sistema inteiro (saldo do cliente, cobrança das 10h e baixa automática) só
-- enxerga 'pendente' e 'vencido', então elas somem da dívida sem sumir do
-- histórico — dá para ver depois o que existia antes do acordo.
--
-- Nada é mexido nas parcelas já pagas nem nos pagamentos lançados.
DO $acordo$
DECLARE
  v_cliente   uuid := 'b2dff07b-6ea0-4575-a255-57e2fac988d6';
  v_antes     numeric;
  v_depois    numeric;
  v_abertas   int;
  v_nota      text := ' · acordo 02/11/2026';
BEGIN
  SELECT coalesce(sum(amount), 0) INTO v_antes
    FROM accounts_receivable
   WHERE customer_id = v_cliente AND status IN ('pendente', 'vencido');

  IF v_antes <> 615.00 THEN
    RAISE EXCEPTION 'Saldo em aberto mudou desde a conferência: R$ % (esperado R$ 615,00). Refaça a conta antes de aplicar.', v_antes;
  END IF;

  -- ---- as três que ficam ----
  UPDATE accounts_receivable
     SET amount = 215.00, description = 'Acordo 02/11/2026 (1/3)', updated_at = now()
   WHERE id = 'e700b0f9-2820-47d2-a4db-adb9f89a0bca';   -- vencia 30/10, estava R$ 65,00

  UPDATE accounts_receivable
     SET amount = 215.00, description = 'Acordo 02/11/2026 (2/3)', updated_at = now()
   WHERE id = '70091798-c104-4c34-a665-eed4c5614e0d';   -- 15/11, estava R$ 145,00

  UPDATE accounts_receivable
     SET amount = 185.00, description = 'Acordo 02/11/2026 (3/3)', updated_at = now()
   WHERE id = 'ccac7c53-2e90-46e9-8ea8-245098e4c03a';   -- 30/11, estava R$ 145,00

  -- ---- as quatro que entraram no acordo ----
  UPDATE accounts_receivable
     SET status = 'cancelado',
         description = coalesce(description, 'parcela') || ' · incorporada ao acordo de 02/11/2026',
         updated_at = now()
   WHERE id IN ('5b5dcff4-ef36-4b3f-9a88-ca3e8cf6cf0b',   -- 15/11  R$ 70,00
                '183147bb-5fc8-44a0-b2fd-9dc1f12761c7',   -- 15/12  R$ 70,00
                '64420740-7755-4899-a63f-940248a041f8',   -- 15/01  R$ 70,00
                'c7476897-f6fa-4c0f-9afa-634f8fda43f9');  -- 15/02  R$ 50,00

  -- ---- conferência ----
  SELECT coalesce(sum(amount), 0), count(*) INTO v_depois, v_abertas
    FROM accounts_receivable
   WHERE customer_id = v_cliente AND status IN ('pendente', 'vencido');

  IF v_depois <> 615.00 THEN
    RAISE EXCEPTION 'A conta não fecha: ficou R$ % em aberto (esperado R$ 615,00).', v_depois;
  END IF;
  IF v_abertas <> 3 THEN
    RAISE EXCEPTION 'Deveriam sobrar 3 parcelas em aberto, sobraram %.', v_abertas;
  END IF;
END
$acordo$;
