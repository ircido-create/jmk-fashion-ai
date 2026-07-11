# Módulo: Relatórios de Contas a Receber

O escopo enviado é muito grande para uma única entrega (dashboard, ~10 relatórios, gráficos, exportações, agendamento por e-mail, permissões por perfil, etc.). Vou propor uma implementação **em fases**, respeitando o que já existe no ERP hoje.

## Contexto atual do projeto (o que já temos)

- Tabelas: `accounts_receivable`, `receivable_payments`, `customers`, `sales`, `sale_items`, `profiles`, `user_roles` (admin / vendedor).
- Página `Receivable.tsx` já lista parcelas, dá baixa, exporta PDF simples (`financePdf.ts`).
- Página `Reports.tsx` já existe (posso estender ou criar `/relatorios/contas-receber` como sub-rota dedicada).
- **Não existem hoje**: campos de juros/multa/desconto por parcela, número de NF, vendedor por venda, banco/conta bancária, grupo/categoria de cliente, cidade/estado no cadastro, limite de crédito, centro de custo, competência, agendamento de e-mails, log de responsável por lançamento.

Vários itens do prompt dependem de dados que **não estão no banco**. Vou construir tudo o que os dados atuais permitem e listar claramente o que fica pendente até você decidir estender o schema.

## Fase 1 — Entrega desta rodada (o que farei agora)

Nova página `/relatorios/contas-receber` com abas:

**1. Dashboard (KPIs + gráficos)**
- Cards: Total a Receber, Recebido no período, Vencido, A Vencer, Clientes Inadimplentes, Ticket Médio, Qtd. Títulos, Recebimentos Hoje / Semana / Mês, % Inadimplência, Valor Médio/Cliente.
- Gráficos (recharts): barras de recebimentos por mês, linha de evolução da inadimplência, pizza por status, top 10 clientes por saldo devedor.

**2. Filtros globais** (aplicam-se a todas as abas)
- Cliente (busca por nome/apelido/CPF/telefone — reaproveita padrão de `Receivable.tsx`)
- Período (Emissão / Vencimento / Recebimento) com presets (hoje, semana, mês, ano, custom)
- Status (aberto, recebido, parcial, vencido)
- Vendedor (usa `profiles` — usuário que criou a venda via `sales.created_by` se existir; caso contrário fica desabilitado)
- Faixa de valor (mín/máx)

**3. Relatório Analítico** — uma linha por parcela: Cliente, Venda #, Parcela, Emissão, Vencimento, Dias atraso, Valor, Pago, Saldo, Status, Forma pagamento.

**4. Relatório Sintético (por cliente)** — Cliente, Qtd parcelas, Total, Recebido, Aberto, Vencido, Saldo.

**5. Extrato do Cliente** — clicando num cliente abre modal com linha do tempo: vendas + recebimentos em ordem cronológica, com saldo corrente.

**6. Inadimplência por faixa** — buckets: até 30 / 31-60 / 61-90 / 91-180 / 180+ dias, com clientes, telefone, valor.

**7. Ranking** — Top clientes por: faturamento, saldo devedor, pontualidade (% pago em dia), atrasos.

**8. Fluxo de Recebimentos (previsão)** — gráfico + tabela agregando parcelas futuras por dia/semana/mês.

**9. Exportação** — PDF (jspdf-autotable, já em uso) e Excel (`xlsx` / SheetJS) para qualquer aba. CSV incluso via Excel.

**10. UX** — colunas ordenáveis, paginação, busca em tempo real, totalizadores no rodapé, header sticky, responsivo, tempo de carregamento otimizado com `fetchAll` paginado e `useQuery` com cache.

**Permissões**: admin vê tudo; vendedor vê apenas seus próprios clientes/vendas (se `sales.created_by = auth.uid()`). Sem novos perfis nesta fase.

## Fase 2 — Requer extensão de schema (fora desta rodada, precisa sua aprovação)

Estes itens **não conseguem ser feitos** sem migração de banco / novos campos:

- **Juros, multa, desconto por parcela** → adicionar colunas em `accounts_receivable` e/ou `receivable_payments`.
- **Nota fiscal, documento, banco/conta bancária, competência, centro de custo** → novos campos em `sales` / `accounts_receivable`.
- **Grupo de clientes, categoria, cidade, estado, limite de crédito** → novos campos em `customers`.
- **Vendedor por venda** (hoje não há vínculo firme) → coluna `salesperson_id` em `sales` + UI para atribuir.
- **Relatório por Vendedor com comissões** → precisa tabela de regras de comissão.
- **Renegociação de parcelas** → fluxo próprio + status `renegociado`.
- **Agendamento de envio automático por e-mail** → cron (pg_cron) + edge function + template de e-mail (Lovable Emails, precisa domínio configurado).
- **Novos perfis** (Financeiro, Gerente, Consulta) → adicionar valores ao enum `app_role` + RLS por perfil.
- **Log de "responsável pelo lançamento"** → coluna `created_by` auditada em `accounts_receivable`.
- **Filtros favoritos salvos por usuário** → tabela `user_report_presets`.
- **Word export** → não recomendo (formato ruim para relatório financeiro); PDF+Excel cobrem o caso.

Quando quiser avançar nesses itens, me diga quais priorizar e eu abro uma nova migração + UI.

## Arquivos que serão criados/alterados na Fase 1

```text
src/pages/reports/ReceivableReports.tsx      (nova página com tabs)
src/components/reports/ReceivableKPIs.tsx    (cards de indicadores)
src/components/reports/ReceivableCharts.tsx  (gráficos recharts)
src/components/reports/ReceivableFilters.tsx (barra de filtros compartilhada)
src/components/reports/AnalyticTable.tsx
src/components/reports/SyntheticTable.tsx
src/components/reports/AgingReport.tsx
src/components/reports/RankingReport.tsx
src/components/reports/CashflowForecast.tsx
src/components/reports/CustomerStatementDialog.tsx
src/hooks/useReceivableData.ts               (fetch + agregação, react-query)
src/lib/receivableExport.ts                  (PDF + XLSX)
src/App.tsx                                  (rota /relatorios/contas-receber)
src/components/layout/AppSidebar.tsx         (link no menu, sob "Relatórios")
```

Dependência nova: `xlsx` (SheetJS) para exportar Excel.

## Pergunta rápida antes de codar

Confirma que quer que eu:
1. **Vá em frente com a Fase 1 agora**, e
2. Deixe a Fase 2 (schema + e-mail + comissões + novos perfis) para uma próxima rodada, quando você priorizar os itens?

Se quiser cortar/adicionar algo da Fase 1, me diga também.
