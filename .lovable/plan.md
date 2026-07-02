## Ajuste no Painel — card "Vencidos"

Hoje o card **Vencidos** mostra apenas a quantidade de títulos vencidos. Vou alterar para exibir também o **valor total em R$**, mantendo a contagem como informação secundária.

### Alterações em `src/pages/Dashboard.tsx`

1. Na função `loadAll`, trocar a consulta atual (que traz só `count`) por uma que retorne também os valores:
   - Buscar `amount` de `accounts_receivable` com `status = 'pendente'` e `due_date < hoje`.
   - Somar em `overdueAmount` além de contar em `overdueCount`.

2. Ampliar o estado `stats` para incluir `overdueAmount: number`.

3. No array `cards`, alterar o item **Vencidos**:
   - `value` passa a ser `R$ X,XX` (valor total).
   - Adicionar um subtítulo/linha extra com "N título(s)" abaixo do valor (mesmo padrão visual dos outros cards de valor).

Nenhuma outra tela é afetada.
