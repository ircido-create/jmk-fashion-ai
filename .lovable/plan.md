# PATRICIA AVELAR — verificação da exclusão e limpeza da dívida

## O que os dados mostram

Cliente: PATRICIA AVELAR (+55 11 92252-7762). Hoje ela tem 9 parcelas em aberto, R$ 923,00 no total, vindas de dois grupos:

1. **Venda de hoje (01/09, R$ 340,00)** — existe normalmente no sistema, com 4 parcelas de R$ 85,00 (set a dez), corretamente vinculadas à venda. Nada errado aqui.

2. **Grupo de 12/08 — R$ 583,00 em 5 parcelas** ("Carteira 2/6 a 6/6", vencendo de out/2026 a fev/2027): **não existe nenhuma venda no sistema para essas parcelas**. A parcela 1/6 também já não existe. Não há nenhum pagamento nem comprovante registrado para elas.

Conclusão: a venda de 12/08 foi excluída, mas as parcelas dela **não foram estornadas** — a cliente segue com R$ 583,00 de dívida fantasma. É exatamente a falha antiga (parcelas 2 em diante não eram encontradas na exclusão), já corrigida para vendas novas pelo vínculo `sale_id`.

## O que proponho fazer

1. **Estornar a dívida fantasma**: excluir as 5 parcelas órfãs de 12/08 (R$ 583,00) da conta da PATRICIA AVELAR. Depois disso a dívida dela fica em R$ 340,00 (só a venda de hoje).
   - Observação: o estoque dessa venda de 12/08 não pode ser estornado agora — a venda e seus itens já foram apagados, não há registro do que sair. Se você souber as peças, dá para ajustar o estoque manualmente.

2. **Registro de exclusões (auditoria)** para não acontecer de novo às cegas:
   - Nova tabela guardando cada exclusão de venda: cliente, valor, data, itens, parcelas removidas (valor e vencimento), peças estornadas ao estoque, quem excluiu e quando.
   - Tela "Vendas excluídas" na página de Vendas, com busca por cliente e período, para conferir a qualquer momento se o valor saiu da conta da cliente.

3. **Varredura das demais órfãs**: existem outros 26 lançamentos antigos sem venda vinculada (TALITA, ELIZABETE, Leila Assis, CONSTANCIA, ANDREA, RAQUEL, WILLIANE). Depois da limpeza da Patricia, listo caso a caso para você aprovar quais são dívida real e quais são resíduo de exclusão.

## Detalhes técnicos

- Remoção das 5 parcelas por `id` (ccdf5747, 3fb30309, 41e52436, d9cf306f, c62bfc9d) — nenhuma tem pagamento ou comprovante vinculado.
- Migração: tabela `deleted_sales_log` (`sale_id`, `customer_id`, `customer_name`, `sale_total`, `sale_date`, `items` jsonb, `removed_receivables` jsonb, `restored_stock` jsonb, `deleted_by`, `created_at`), com GRANTs e RLS para autenticados.
- `src/pages/Sales.tsx`: gravar o snapshot em `deleted_sales_log` dentro de `confirmDeleteSale` antes dos deletes; toast final resumindo peças estornadas e parcelas removidas; nova aba/rota listando o histórico de exclusões.
