
# Importar extrato de contas a receber + cadastrar clientes com CPF/CNPJ

## O que o arquivo contém

153 lançamentos = parcelas em aberto entre fev/2026 e abr/2026. Agrupados por CPF/CNPJ resultam em ~107 clientes únicos. Algumas pessoas aparecem com nomes ligeiramente diferentes no mesmo CPF — vou consolidar usando o nome mais completo.

## Mudanças

### 1. Adicionar campo CPF/CNPJ na tabela `customers` (migration)

- Coluna `tax_id` (text, nullable, único quando preenchido)
- Índice único parcial: `CREATE UNIQUE INDEX ON customers (tax_id) WHERE tax_id IS NOT NULL` — garante que o mesmo CPF não vire dois cadastros
- Armazenar apenas dígitos (sem pontos/traços/barras) para facilitar busca e deduplicação

### 2. Atualizar UI de Clientes (`src/pages/Customers.tsx` e `src/pages/CustomerDetail.tsx`)

- Novo campo "CPF/CNPJ" no formulário, com máscara de exibição (`000.000.000-00` ou `00.000.000/0000-00`)
- Mostrar CPF/CNPJ na lista e na tela de detalhe
- Busca passa a aceitar CPF/CNPJ (com ou sem pontuação)
- Validação: 11 dígitos (CPF) ou 14 dígitos (CNPJ); permite vazio

### 3. Importar os dados do extrato (script de seed via tool de insert)

**Etapa A — clientes únicos (~107 registros):**
- Agrupar linhas por CPF/CNPJ (dígitos apenas)
- Para cada CPF, escolher o nome mais longo/completo como `name`
- Inserir em `customers` com `tax_id` preenchido. Se CPF já existir no banco, atualizar o nome (não duplicar).

**Etapa B — contas a receber (153 registros):**
- Para cada linha do extrato:
  - `customer_id` = id do cliente correspondente (lookup pelo `tax_id`)
  - `due_date` = data da linha (formato `YYYY-MM-DD`)
  - `amount` = valor da linha
  - `status` = `pendente`
  - `description` = `"Parcela carteira — " + data formatada`

### 4. Sobre o modelo "carteira" (parcela variável)

O schema atual de `accounts_receivable` já comporta isso sem mudanças. Cada parcela é uma conta independente com seu valor e vencimento. O fluxo operacional fica:

- Cliente pagou exatamente o valor → marcar conta como `pago`
- Cliente pagou **a mais** (ex: parcela 200, pagou 250) → marcar como `pago` + criar conta a receber **negativa** (-50) ou abater a diferença na próxima parcela em aberto
- Cliente pagou **a menos** (ex: parcela 200, pagou 180) → marcar como `pago` + criar nova conta de R$ 20 com vencimento na próxima data

Esse fluxo de baixa não está sendo construído agora — só o cadastro/importação. Posso construir a tela de "baixa com saldo" depois se quiser. Para esta tarefa, importo tudo como `pendente`.

## Resultado esperado

- ~107 clientes novos cadastrados, cada um com seu CPF/CNPJ
- 153 contas a receber em aberto vinculadas aos respectivos clientes
- Tela de Clientes mostra CPF/CNPJ e permite buscar por ele
- Tela de Contas a Receber lista as 153 parcelas agrupáveis por cliente

## Arquivos afetados

- `supabase/migrations/` (nova migration: coluna `tax_id` + índice único)
- `src/pages/Customers.tsx` (campo CPF/CNPJ + busca + máscara)
- `src/pages/CustomerDetail.tsx` (exibir CPF/CNPJ)
- Inserts via tool de banco (sem arquivo de script no repo)

## Confirmações que preciso antes de executar

1. **Confirmar a importação em massa** — vou criar 107 clientes e 153 contas a receber. Sem volta fácil (precisa rodar delete em massa de novo).
2. O extrato tem datas que parecem ser **datas de vencimento** (algumas já passadas, fev/mar/2026). Vou usar como `due_date`. Ok?
