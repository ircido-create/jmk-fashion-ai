# Parcelamento da parte na carteira (pagamento misto) no PDV

Hoje, no pagamento misto, a parte lançada em "Carteira (Fiado)" gera **uma única** conta a receber, com apenas a data de vencimento escolhida. A ideia é permitir dividir essa parte em várias parcelas.

## O que muda

Na etapa de pagamento do PDV, quando o pagamento misto incluir "Carteira (Fiado)", o bloco de vencimento passa a mostrar:

- **Nº de parcelas** (1x a 12x), com o valor de cada parcela calculado automaticamente
- **Vencimento da 1ª parcela** (já existente)
- Um resumo, ex.: "3x de R$ 100,00 — 1ª em 12/09/2026"

Ao finalizar a venda, são criadas N contas a receber mensais na carteira do cliente (a primeira na data escolhida, as demais somando 1 mês), com descrição "Pagamento misto — carteira (1/3)", etc. Os centavos de arredondamento vão para a última parcela.

O restante do fluxo (formas de pagamento, cupom, estoque, venda) não muda. Vendas sem parte na carteira seguem iguais.

## Detalhes técnicos

Arquivo único: `src/pages/POS.tsx`

- Novo estado `splitFiadoInstallments` (padrão 1), resetado ao desligar o modo misto.
- UI: adicionar `Select` de parcelas dentro do bloco condicional `splits.some(s => s.method === "fiado")` (linhas ~820-830), junto ao input de data.
- Em `finalize()`, no ramo `else if (splitFiadoAmount > 0)` (linhas ~425-439), substituir o insert único por um laço que monta N registros usando o mesmo padrão de `addMonths` e ajuste de centavos já usado no ramo de fiado puro; `firstReceivableId` continua sendo o id da primeira parcela.
- O campo `installments` da venda passa a registrar o número de parcelas da parte na carteira quando em modo misto (hoje fica sempre 1).
