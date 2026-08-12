# Desconto no carrinho do PDV

Adicionar um campo de desconto no carrinho da Frente de Caixa, logo acima do Total.

## Como vai funcionar

- Nova linha "Desconto" entre "Itens" e "Total", com:
  - campo de valor
  - alternador R$ / % (percentual calculado sobre o subtotal)
- O carrinho passa a mostrar: Subtotal, Desconto (em vermelho, com sinal negativo) e Total final.
- Desconto limitado ao subtotal (nunca deixa o total negativo) e nunca negativo.
- O Total com desconto passa a valer para tudo no fluxo: pagamento à vista, parcelamento, pagamento misto (soma das formas deve bater com o total já com desconto), troco em dinheiro e geração das contas a receber.
- O cupom/recibo passa a exibir Subtotal, Desconto e Total.
- Ao limpar o carrinho ou finalizar a venda, o desconto é zerado.

## Detalhes técnicos

Arquivo: `src/pages/POS.tsx`

- `subtotal` = soma atual dos itens; novos estados `discountValue` (string) e `discountType` ("valor" | "percent"); `discountAmount` derivado e limitado a `[0, subtotal]`; `total = subtotal - discountAmount`.
- Todas as referências existentes a `total` (parcelas, splits, troco, `sales.total`) continuam usando a variável `total`, agora já líquida.
- No insert da venda, registrar o desconto na observação (`notes`) para rastreio, mantendo `total` líquido.
- Estado do recibo ganha `discount` e `subtotal` bruto para exibição.
