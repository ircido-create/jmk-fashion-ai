# Verificação das exclusões de venda de hoje + trilha de auditoria

## O que a verificação mostrou (dados de hoje, 31/08 a 01/09)

- Existem 12 vendas registradas hoje. Todas as 47 parcelas criadas hoje continuam ligadas a uma venda que existe.
- Nenhuma parcela ficou "solta" por causa de exclusão de venda hoje. O único lançamento sem venda é a cobrança manual "RABICHO" (R$ 20,00, DEBORA RIBEIRO DE CASTRO), criada à mão — não é resíduo de exclusão.
- Ou seja: não há indício de venda excluída hoje deixando dívida na conta da cliente. Se alguma venda foi excluída hoje, as parcelas dela foram removidas corretamente.
- Restam 31 parcelas antigas (julho/agosto) sem venda vinculada — são grupos incompletos (falta a 1ª parcela, etc.), típicos de ajustes manuais antigos, anteriores ao vínculo por venda. Podem ser revisadas separadamente se você quiser.

Limitação importante: hoje o sistema **não guarda registro de vendas excluídas**, nem de estorno de estoque. Por isso a verificação só consegue ser indireta (procurar resíduos), e não é possível dizer com certeza quais vendas foram apagadas nem se cada peça voltou ao estoque.

## O que proponho construir

1. **Registro de exclusões (auditoria)**
   - Nova tabela no banco guardando, a cada exclusão: cliente, valor da venda, data da venda, itens (nome/quantidade/variação), parcelas removidas com valores e vencimentos, peças estornadas ao estoque, quem excluiu e quando.
   - Gravação feita pela tela de Vendas no momento da exclusão, antes de apagar os dados.

2. **Tela "Vendas excluídas"**
   - Aba/filtro na página de Vendas listando as exclusões, com busca por cliente e período, e detalhe expandindo itens, parcelas removidas e estoque estornado.
   - Assim dá para conferir, a qualquer momento, se o valor saiu da conta da cliente e se as peças voltaram.

3. **Confirmação visível do estorno**
   - Após excluir, o aviso passa a mostrar exatamente: X peça(s) devolvidas ao estoque, Y parcela(s) removidas totalizando R$ Z.

## Detalhes técnicos

- Migração: tabela `deleted_sales_log` (campos: `sale_id` original, `customer_id`, `customer_name`, `sale_total`, `sale_date`, `items` jsonb, `removed_receivables` jsonb, `restored_stock` jsonb, `deleted_by`, `created_at`), com GRANTs e RLS para usuários autenticados (leitura para todos autenticados, inserção pelo próprio usuário).
- `src/pages/Sales.tsx`: em `confirmDeleteSale`, montar o snapshot e inserir em `deleted_sales_log` antes dos deletes; toast final com o resumo do estorno.
- Nova seção na página de Vendas (ou rota `/vendas/excluidas`) consumindo `deleted_sales_log`, com paginação e busca.
