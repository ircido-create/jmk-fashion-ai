# Excluir venda: parcelas continuam em aberto

## O problema (confirmado)

Ao excluir uma venda, o sistema tenta achar as contas a receber da venda de duas formas:

1. pelo campo `receivable_id` da venda (que guarda **só a primeira parcela**);
2. por descrição contendo "venda XXXXXXXX".

Só que o PDV grava as parcelas com descrição no formato "Carteira (2/4) — 1 item(ns)" — nenhuma contém "venda XXXXXXXX". Conferido no banco: nenhuma conta a receber tem esse texto.

Resultado: ao excluir a venda, **apenas a 1ª parcela** é removida. As parcelas 2, 3, 4... ficam no sistema e o cliente continua devendo — foi exatamente o que aconteceu.

## Como corrigir

### 1. Vincular parcelas à venda de verdade

- Nova coluna `sale_id` em contas a receber, apontando para a venda.
- O PDV passa a gravar `sale_id` em **todas** as parcelas geradas.
- A tela de Vendas (alterar forma de pagamento) também passa a gravar `sale_id` nas parcelas que recria.

### 2. Preencher o histórico

Backfill das vendas existentes: para cada venda com `receivable_id`, marcar como pertencentes àquela venda todas as parcelas do mesmo cliente criadas no mesmo instante (as parcelas de uma venda são inseridas em lote, com o mesmo horário de criação) e com a mesma numeração de série. Assim vendas antigas também passam a excluir corretamente.

### 3. Corrigir a exclusão e a trava de pagamento

- A busca das parcelas da venda passa a usar `sale_id` (mantendo `receivable_id` como reserva).
- O diálogo de exclusão mostra a lista completa das parcelas que serão removidas, com o valor total.
- A trava continua: se qualquer parcela estiver paga ou tiver comprovante vinculado, a exclusão é bloqueada.

### 4. Limpar a venda que já foi excluída

Depois de aplicada a correção, identifico as parcelas órfãs geradas pela venda que você excluiu (sem venda correspondente) e removo, confirmando antes com você o cliente e o valor.

## Detalhes técnicos

- Migração: `ALTER TABLE public.accounts_receivable ADD COLUMN sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL` + índice + UPDATE de backfill por (`customer_id`, `created_at`).
- `src/pages/POS.tsx`: cria a venda antes das parcelas (ou faz update das parcelas com o `sale_id` logo após criar a venda) para preencher o vínculo.
- `src/pages/Sales.tsx`: `fetchSaleReceivables` passa a filtrar por `sale_id.eq.<id>` ou `id.eq.<receivable_id>`; `savePayEdit` grava `sale_id` nas novas parcelas.
