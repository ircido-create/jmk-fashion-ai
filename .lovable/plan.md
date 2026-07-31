## Plano: Adicionar card de "Valores Vencidos do Mês" na Dashboard

### O que será feito
Incluir na homepage (Dashboard) um novo card que mostre o total em atraso (contas a receber vencidas) com data de vencimento no mês corrente.

### Implementação
1. Em `src/pages/Dashboard.tsx`, buscar no `loadAll` as contas a receber com `status = 'vencido'` e `due_date` dentro do mês atual.
2. Somar os valores e guardar no estado `stats` (novo campo `overdueMonth`).
3. Adicionar um novo card ao array `cards` com o label "Atrasados do Mês" e o valor formatado em reais, respeitando o toggle de visualização de valores (olho).

### Card novo
- **Label:** Atrasados do Mês
- **Valor:** soma de `accounts_receivable.amount` onde `status = 'vencido'` e `due_date` começa com `yyyy-MM` do mês atual.
- **Sub:** quantidade de título(s) em atraso no mês.

### Cards mantidos
- Vendas do Dia
- Vendas do Mês
- Recebido no Mês

### Arquivo afetado
- `src/pages/Dashboard.tsx`

### Validação
- Verificar no preview se o novo card aparece com o valor e a quantidade corretos.
