## Objetivo
Permitir alterar a **forma de pagamento** (e parcelas) de uma venda já finalizada, na página **Vendas**.

## Mudanças

### `src/pages/Sales.tsx`
- Adicionar botão **"Forma de pagamento"** em cada card de venda (ao lado de "Reimprimir cupom").
- Abrir um `Dialog` com:
  - `Select` de método: PIX, Dinheiro, Cartão Crédito, Cartão Débito, Link de Pagamento, Fiado, Misto.
  - Campo **Parcelas** (1–12), visível quando método = Cartão Crédito ou Fiado.
  - Botão **Salvar**.
- Ao salvar: `UPDATE sales SET payment_method, installments WHERE id = ...` e recarregar a lista.
- O cupom reimpresso passa a refletir a nova forma de pagamento (já lê `s.payment_method`).

## Fora de escopo
- Não altera `accounts_receivable` existentes (mudar de "fiado" para "pix" não quita a dívida automaticamente — isso continua sendo feito em Contas a Receber).
- Sem mudanças de schema — colunas `payment_method` e `installments` já existem em `sales`.
