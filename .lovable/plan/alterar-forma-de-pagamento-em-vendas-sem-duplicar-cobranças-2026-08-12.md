# Alterar forma de pagamento em Vendas sem duplicar cobranças

## Problema confirmado
Ao editar a forma de pagamento de uma venda já finalizada, o sistema apenas **cria** novas contas a receber e nunca remove/ajusta as antigas. Resultado: a mesma venda gera cobranças repetidas, como se fosse uma nova venda.

Exemplo verificado no banco: a venda `372FB4B9` possui 7 parcelas "Fiado (x/7)" criadas em 12/08 pela edição, além do que já existia antes da alteração.

## O que será feito
1. **Substituir, não somar**: ao salvar a nova forma de pagamento, o sistema primeiro remove as contas a receber **ainda em aberto** ligadas àquela venda e só depois gera as novas conforme a forma escolhida.
2. **Proteger pagamentos já feitos**: parcelas com status "pago" (ou com comprovante vinculado) nunca são apagadas. Se existirem, o sistema avisa e mantém essas parcelas, ajustando apenas o saldo restante.
3. **Sem carteira = sem cobrança**: se a venda passar de fiado/misto para pix, dinheiro, débito ou crédito, as cobranças em aberto daquela venda são removidas.
4. **Vínculo correto**: a venda passa a apontar para a cobrança gerada (campo de vínculo atualizado), evitando registros órfãos.
5. **Confirmação clara**: antes de salvar, o diálogo mostra um resumo do que será feito ("serão substituídas N parcelas em aberto por M novas parcelas").

## Limpeza dos dados já duplicados
Após aprovação, verifico as vendas que sofreram edição de forma de pagamento e removo as parcelas duplicadas em aberto (mantendo um único conjunto correto). Nada pago será alterado.

## Detalhes técnicos
- Arquivo: `src/pages/Sales.tsx`, função `savePayEdit`.
- Identificação das cobranças da venda: `sales.receivable_id` + `accounts_receivable.description` contendo o código curto da venda (`id.slice(0,8)`), padrão já usado hoje ("Fiado (x/y) — venda XXXX" e "Pagamento misto — parte na carteira — venda XXXX").
- Exclusão restrita a `status = 'pendente' | 'vencido'` e sem linhas em `receivable_payments`.
- Reuso do mesmo cálculo de parcelas atual (arredondamento com ajuste de centavos na última parcela).
