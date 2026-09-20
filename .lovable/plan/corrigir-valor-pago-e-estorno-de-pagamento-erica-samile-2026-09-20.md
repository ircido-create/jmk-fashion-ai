# Corrigir valor pago e estorno de pagamento — Erica Samile

## Diagnóstico confirmado

- O recebimento de **R$ 300,00** da Erica está gravado e foi distribuído corretamente: **R$ 262,00** quitaram a parcela 1 e **R$ 38,00** reduziram a parcela 2 de R$ 262,00 para R$ 224,00.
- A tela mostra apenas os **R$ 262,00 da parcela quitada**, por isso parece que faltaram R$ 38,00.
- Ao excluir o comprovante atualmente, os vínculos do pagamento são apagados automaticamente, mas a parcela quitada não volta para aberto e o valor abatido da parcela parcial não é recomposto.

## Correção

1. **Mostrar o recebimento completo**
   - Exibir o total efetivamente recebido no comprovante/histórico: R$ 300,00.
   - Manter o detalhamento da distribuição entre parcelas, para ficar claro onde cada parte foi aplicada.

2. **Estorno completo e seguro**
   - Criar uma operação única para excluir o pagamento e restaurar todas as parcelas atingidas.
   - Parcela quitada: limpar a data de pagamento e voltar para **Vencido** se a data já passou, ou **A vencer** se ainda não venceu.
   - Parcela parcialmente abatida: somar novamente o valor abatido ao saldo da parcela.
   - Só remover o comprovante depois que toda a dívida tiver sido restaurada; em caso de erro, nenhuma alteração parcial será mantida.

3. **Aplicar à Erica sem mudar o saldo atual**
   - Não alterar agora o saldo da Erica, pois os R$ 300,00 já estão corretamente aplicados.
   - A correção será na exibição e no comportamento caso esse pagamento seja excluído.

4. **Validar os cenários**
   - Pagamento que quita uma parcela e reduz outra, como o da Erica.
   - Exclusão com parcela vencida, vencendo hoje e ainda a vencer.
   - Conferir que o total em aberto retorna exatamente ao valor anterior ao pagamento.

## Detalhes técnicos

- Migration com função transacional de estorno baseada em `receivable_payments`, antes da exclusão em cascata.
- Atualização da página de comprovantes para usar essa função e mostrar o total de `amount_paid` agrupado por comprovante.
- Testes da regra de status por data e da recomposição integral/parcial dos valores.
