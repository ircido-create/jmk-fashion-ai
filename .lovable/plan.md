## Objetivo
Exibir na homepage (Dashboard) um novo indicador com o **valor total recebido no mês atual** (pagamentos efetivamente recebidos dos clientes).

## Alterações propostas

### 1. Novo indicador "Recebido no Mês"
- Adicionar um novo card no grid superior do Dashboard com o label **"Recebido no Mês"**.
- O valor será a soma dos registros da tabela `accounts_receivable` cujo `status` seja `pago` e o `paid_at` esteja dentro do mês atual.
  - Alternativa: caso `paid_at` não esteja consistentemente preenchido, somar os registros da tabela `receivable_payments` com `created_at` no mês atual. A implementação escolherá a fonte que refletir o dado real do projeto.
- O valor será formatado em reais (BRL) e respeitará o estado do botão de "olho" (ocultar/mostrar valores) já existente na tela.

### 2. Integração com o estado de visualização
- O novo card será adicionado ao array de cards do Dashboard, já usando a lógica de `showValues` para exibir `R$ ••••••` quando os valores estiverem ocultos.
- O ícone do card será um ícone de pagamento/baixa (ex.: `CheckCircle2` ou `Wallet`) com gradiente verde/tesouraria para diferenciar de vendas.

### 3. Ajustes no carregamento de dados
- Atualizar a função `loadAll` em `src/pages/Dashboard.tsx` para buscar os recebimentos pagos do mês junto com as demais métricas.
- A query será feita com `supabase.from("accounts_receivable").select("amount, paid_at").eq("status", "pago").gte("paid_at", inicioDoMes)` (ou equivalente conforme a fonte de dados real).

## Arquivos modificados
- `src/pages/Dashboard.tsx`

## Não incluso no escopo
- Não serão criadas novas tabelas, migrations, rotas ou backend.
- Não serão alterados outros relatórios ou páginas.

## Resultado esperado
A homepage mostrará, além de Vendas do Dia/Mês, o valor total efetivamente recebido no mês, ajudando a acompanhar o fluxo de caixa de forma imediata.