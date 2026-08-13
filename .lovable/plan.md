# Mostrar crédito quando o cliente paga a mais

## Situação confirmada (CELINA BETE)

O cliente tem 3 parcelas, todas quitadas:

```text
10/07  R$  45,00   pago R$  45,00
10/08  R$  35,00   pago R$ 140,00   <-- pagou R$ 105,00 a mais
10/09  R$ 140,00   pago R$ 140,00
```

Hoje o sistema só soma o que está em aberto (R$ 0,00) e o excedente de R$ 105,00
simplesmente some da tela. A intenção é exibir isso como **crédito do cliente**.

## Regra de cálculo

Crédito = soma, por parcela, de `max(0, valor_pago - valor_da_parcela)`.

- Saldo devedor continua sendo a soma do que está em aberto.
- Se houver dívida em aberto e crédito ao mesmo tempo, mostramos os dois valores
  separados (não abate automaticamente — sem mudar nenhuma baixa já feita).

## Onde o crédito aparece

1. **Detalhe do cliente** — novo card "Crédito disponível" ao lado de "Saldo em
   aberto", em verde, só quando maior que zero, com a lista das parcelas que
   geraram o excedente.
2. **Seleção de cliente no PDV e em Vendas** — o mesmo badge que hoje mostra a
   dívida passa a mostrar "Crédito: R$ 105,00" em verde quando o cliente tem
   crédito e nenhuma dívida (e ambos quando houver os dois).
3. **Lista de clientes e Contas a Receber** — indicador discreto de crédito na
   linha do cliente.

Nada é debitado nem lançado automaticamente: é uma exibição informativa para o
vendedor saber que o cliente tem valor a favor.

## Detalhes técnicos

- `src/hooks/useCustomerDebt.ts`: passa a buscar todas as parcelas do cliente
  (não só as pendentes) com `receivable_payments(amount_paid)` e retorna também
  `credit`, mantendo `debt` com o comportamento atual.
- `src/pages/CustomerDetail.tsx`: já carrega parcelas; adicionar a busca dos
  pagamentos ligados e o novo card + detalhamento.
- `src/pages/POS.tsx` e `src/pages/Sales.tsx`: usar o novo campo `credit` do hook
  no badge existente.
- `src/pages/Customers.tsx` e `src/pages/Receivable.tsx`: agregação por cliente
  em uma única consulta para não impactar performance da listagem.
- Sem migração de banco e sem alteração em regras de baixa/conciliação.
