## Objetivo
Atualizar a homepage (Dashboard) para exibir **Vendas do Dia** e **Vendas do Mês**, e adicionar um botão de "olho" que permite ocultar/exibir todos os valores numéricos sensíveis da tela.

## Alterações propostas

### 1. Novos indicadores de venda
- Adicionar dois novos cards no grid superior do Dashboard:
  - **Vendas do Dia**: soma do campo `total` da tabela `sales` onde `sale_date` for igual à data atual.
  - **Vendas do Mês**: soma do campo `total` da tabela `sales` onde `sale_date` estiver dentro do mês/ano atual.
- Os valores serão formatados em reais (BRL) e exibidos com o mesmo estilo visual dos cards existentes (ícone em gradiente, tipografia, animação `animate-fade-in`).

### 2. Botão de ocultar/exibir valores ("olho")
- Adicionar um ícone de olho (aberto/fechado) no cabeçalho da página (ao lado do título ou nas ações do `PageHeader`).
- Ao clicar, alterna um estado `showValues` (boolean).
- Quando oculto (`showValues = false`), todos os valores monetários e quantitativos da tela serão substituídos por uma máscara (ex.: `R$ ••••••` ou `•••`).
- A escolha de ocultar/exibir deve afetar:
  - Vendas do Dia / Mês
  - A Receber / A Pagar / Vencidos
  - Total de Clientes / Produtos / Estoque baixo
  - Tooltips do gráfico de movimentação

### 3. Ajustes no carregamento de dados
- Atualizar a função `loadAll` em `src/pages/Dashboard.tsx` para buscar também as vendas do dia e do mês via `supabase.from("sales").select("total, sale_date")` com filtros de data.
- Os cálculos serão feitos localmente após o fetch, mantendo o padrão atual da página.

## Arquivos modificados
- `src/pages/Dashboard.tsx`
- Possível importação adicional de ícones (`Eye`, `EyeOff`) do `lucide-react`.

## Não incluso no escopo
- Não serão criadas novas tabelas, migrations, rotas ou backend.
- Não serão alterados outros dashboards ou relatórios.

## Resultado esperado
A homepage mostrará, de forma clara, quanto foi vendido hoje e no mês, com um botão prático para o usuário esconder todos os valores numéricos da tela (útil para privacidade em compartilhamentos de tela).