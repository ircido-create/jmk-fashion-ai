# Andrea Carmo dos Santos — parcelas 3 e 4 da venda DF92F55E

## O que os dados mostram

No dia 04/07 foram registradas **4 vendas iguais de R$ 500,00** para a Andrea, em poucos minutos (461D7D3C, B9C729DC, 72D17952 e DF92F55E) — repetições da mesma venda. Só a **DF92F55E** tem as peças lançadas; as outras três estão vazias.

As parcelas foram gravadas ligadas à venda **72D17952**, e hoje sobraram apenas duas:

- Carteira (1/4) — R$ 125,00 — venc. 10/07 — **paga**
- Carteira (2/4) — R$ 125,00 — venc. 10/08 — **paga**

As parcelas **3/4 e 4/4 (R$ 125,00 cada, total R$ 250,00) foram apagadas** numa limpeza anterior de títulos "órfãos" — na verdade eram parcelas legítimas desta venda. Por isso a cliente aparece sem saldo em aberto.

## Correção

1. **Recriar as duas parcelas que faltam**, em aberto:
   - Carteira (3/4) — R$ 125,00 — vencimento 10/09/2026
   - Carteira (4/4) — R$ 125,00 — vencimento 10/10/2026
   Ambas ligadas à venda correta e à cliente Andrea.
2. **Unificar a venda**: as 4 parcelas passam a apontar para a venda DF92F55E (a que tem as peças), e essa venda passa a referenciar a 1ª parcela.
3. **Remover as 3 vendas duplicadas vazias** (461D7D3C, B9C729DC, 72D17952), que não têm itens nem pagamentos. Nada de estoque é afetado, pois elas não têm peças.

Resultado: a Andrea volta a ter **R$ 250,00 em aberto** (parcelas 3 e 4), e a venda DF92F55E mostra as 4 parcelas.

## Detalhes técnicos

- Migração de dados: `INSERT` de 2 linhas em `accounts_receivable` (status `pendente`/`vencido` conforme a data, `sale_id = df92f55e...`, `customer_id = 88baf131...`), `UPDATE` das parcelas 1/4 e 2/4 para `sale_id = df92f55e...`, `UPDATE sales SET receivable_id` na DF92F55E e `DELETE` das 3 vendas duplicadas sem itens.
- Nenhuma alteração de código de tela é necessária — a tela de Contas a Receber já lista por cliente.
