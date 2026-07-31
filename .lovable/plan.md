## Plano: Ajustar cards da Homepage (Dashboard)

### O que será feito
Remover da `src/pages/Dashboard.tsx` os cards que não devem mais aparecer na homepage, mantendo apenas os indicadores de vendas e recebimentos.

### Cards removidos
- `A Receber`
- `A Pagar`
- `Vencidos` (também é um valor a receber)
- `Produtos`
- `Estoque baixo`

### Cards mantidos
- `Vendas do Dia`
- `Vendas do Mês`
- `Recebido no Mês`
- `Clientes`

### Cards alterados
- Nenhuma alteração de comportamento; o botão de "olho" continua funcionando para os cards restantes.

### Gráfico
- O gráfico `Movimentação dos últimos 6 meses` será mantido, conforme sua resposta.

### Arquivo afetado
- `src/pages/Dashboard.tsx`

### Validação
- Verificar no preview se os cards removidos sumiram e os mantidos continuam exibidos corretamente.
