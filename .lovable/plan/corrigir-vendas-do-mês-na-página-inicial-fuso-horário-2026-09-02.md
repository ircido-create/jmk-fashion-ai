# Corrigir "Vendas do Mês" na página inicial (fuso horário)

## O que está acontecendo

O card mostra **R$ 27.185,00** para setembro, mas esse valor inclui vendas feitas na **noite de 31/08 (horário de Brasília)**.

Verificado no banco: das 30 vendas contadas como setembro, **21 delas (R$ 20.890,00)** foram registradas entre 00:00 e 03:00 UTC do dia 01/09 — ou seja, entre 21:00 e 00:00 do dia **31/08** no horário de Brasília.

Causa: o Dashboard compara a data cortando os 10 primeiros caracteres da data em **UTC** (`sale_date.slice(0,10)`) e monta "hoje"/"início do mês" também em UTC. Como Brasília é UTC-3, tudo que acontece após as 21:00 já "vira" o dia seguinte no cálculo.

Isso afeta os cards **Vendas do Dia**, **Vendas do Mês**, **Recebido no Mês**, o card de vencidos e também o gráfico dos últimos 6 meses e os relatórios em PDF gerados pelos cards.

## O que será feito

1. Criar um utilitário de data em fuso de São Paulo (`America/Sao_Paulo`) com funções para "hoje" e "início do mês" e para converter um timestamp em data local (`yyyy-MM-dd`).
2. Usar esse utilitário no Dashboard para todos os filtros de vendas do dia, vendas do mês, recebido no mês, vencidos e gráfico mensal.
3. Aplicar a mesma correção em `src/lib/dashboardReports.ts`, para que os PDFs mostrem exatamente os mesmos números dos cards.
4. Conferir no preview que "Vendas do Mês" passa a mostrar apenas as vendas de 01/09 em diante no horário de Brasília (valor esperado: cerca de **R$ 6.295,00**, sujeito a novas vendas do dia).

## Detalhes técnicos

- Novo `src/lib/tz.ts` com `toSaoPauloDate(iso: string): string` usando `Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })`, mais `todaySP()` e `monthStartSP()`.
- Substituir `new Date().toISOString().slice(0,10)` e `s.sale_date.slice(0,10)` pelas versões em fuso local.
- Nenhuma alteração de dados: as vendas ficam como estão, apenas o agrupamento por data é corrigido.
