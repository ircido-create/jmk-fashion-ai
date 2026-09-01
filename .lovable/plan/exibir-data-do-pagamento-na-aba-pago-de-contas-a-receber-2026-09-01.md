# Exibir data do pagamento na aba "Pago" de Contas a Receber

## O que será feito
Na tela **Contas a Receber**, quando o usuário estiver na aba **Pago**, cada título pago mostrará a data em que foi quitado, além da data de vencimento.

## Como será feito
1. `src/pages/Receivable.tsx`
   - Manter o campo `paid_at` (já carregado) e adicionar a data do comprovante (`payment_proofs.payment_date`) como fallback, ao buscar os vínculos de `receivable_payments`.
   - Na renderização da lista, quando `r.status === "pago"`, exibir uma linha extra/formatação indicando **"Pago em: dd/MM/yyyy"**.
   - Usar `paid_at` como principal; se estiver nulo, usar a data do primeiro comprovante vinculado.
   - Formatar a data com `format(parseISO(...), "dd/MM/yyyy", { locale: ptBR })`.

2. Não haverá alteração de banco de dados, schemas, edge functions ou migrações — a informação já existe em `accounts_receivable.paid_at` e em `payment_proofs.payment_date`.

## Resultado esperado
- Aba **Pago** mostra, para cada parcela, a data de quitação de forma clara.
- Registros antigos sem `paid_at` mas com comprovante ainda exibem a data.
- Sem impacto nas demais abas (A Receber, A Vencer, Vencido, Todos).
