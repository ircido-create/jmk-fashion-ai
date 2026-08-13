# Desfazer a exibição de crédito por pagamento a maior

Remover tudo o que foi adicionado para mostrar "crédito" quando o cliente paga mais que o valor da parcela, voltando as telas ao comportamento anterior (apenas dívida).

## O que será removido

- **Hook de dívida** (`src/hooks/useCustomerDebt.ts`): volta a retornar apenas `debt` e `loading`; sai o cálculo de excedente de pagamentos.
- **Detalhe do cliente** (`src/pages/CustomerDetail.tsx`): sai o card "Crédito disponível" e a lista das parcelas que geraram excedente, além da busca extra de `receivable_payments` usada só para isso.
- **PDV** (`src/pages/POS.tsx`) e **Vendas** (`src/pages/Sales.tsx`): sai a linha verde de crédito ao selecionar o cliente; permanece apenas a indicação de dívida.
- **Clientes** (`src/pages/Customers.tsx`) e **Contas a Receber** (`src/pages/Receivable.tsx`): saem os badges "Crédito ..." e as consultas/estados que os alimentavam.

## Observações

- Nenhuma alteração no banco de dados: os pagamentos registrados continuam intactos, apenas deixam de ser exibidos como crédito.
- Nenhum outro comportamento de vendas, parcelas ou recebimentos é alterado.
