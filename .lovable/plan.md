## Objetivo
Ao marcar parcelas como recebidas em **Cliente → Carteira**, abrir um diálogo pedindo **data do recebimento** e **valor recebido** antes de quitar.

## Alterações em `src/pages/CustomerDetail.tsx`

1. Substituir o `confirm()` por um `Dialog` (shadcn) acionado pelo botão "Pagar selecionadas".
2. Campos do diálogo:
   - **Data do recebimento** — `Input type="date"`, padrão: hoje.
   - **Valor recebido** — `Input` numérico, padrão: soma das parcelas selecionadas (`selectedTotal`), editável.
   - Exibir resumo: nº de parcelas, total esperado, diferença (se valor recebido ≠ total).
3. Confirmar → executar:
   - `UPDATE accounts_receivable SET status='pago', paid_at=<data escolhida em ISO>` nas parcelas selecionadas.
   - `INSERT INTO receivable_payments (receivable_id, amount_paid)` — um registro por parcela. Quando o valor recebido for igual ao total, cada parcela recebe seu próprio `amount`. Quando for diferente (recebimento parcial/ajustado do lote), ratear proporcionalmente entre as parcelas selecionadas.
4. Manter feedback via `toast` e recarregar (`load()`).

## Observação
Só afeta a UI de recebimento no detalhe do cliente (`/clientes/:id`). Nada muda em `/contas-receber` nem no PDV.
