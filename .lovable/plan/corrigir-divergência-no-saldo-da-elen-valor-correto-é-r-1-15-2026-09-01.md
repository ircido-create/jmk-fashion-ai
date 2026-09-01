# Corrigir divergência no saldo da Elen — valor correto é R$ 1.154,92

## O que está acontecendo

A Elen (ELEN CAMPOS LOURENCO DA SILVA) tem 3 parcelas em aberto:

```text
30/08/2026  Carteira (2/3)   R$ 400,00  vencida
30/09/2026  Carteira (3/3)   R$ 414,92
30/10/2026  Carteira         R$ 340,00
```

Soma = R$ 1.154,92 (valor correto).

Existe um registro de pagamento parcial de R$ 100,00 lançado na parcela 2/3 (a parcela continua com status "vencido", ou seja, não foi quitada). Há também a parcela 1/3, de R$ 200,00, com R$ 500,00 de pagamento registrado — sobra de R$ 300,00 nesse lançamento, indicando que os pagamentos registrados nem sempre correspondem parcela a parcela.

Os dois números que a cliente recebeu vêm de dois caminhos diferentes do atendimento:

- Caminho da IA (contexto de dívidas): usa o valor da parcela → R$ 1.154,92 (correto).
- Atalho da "ficha" (resposta rápida): desconta os pagamentos parciais registrados → R$ 1.054,92 (errado, pois os lançamentos não são confiáveis parcela a parcela).

## Correção

Padronizar tudo pelo valor em aberto da parcela, sem descontar lançamentos parciais: o atalho da ficha passa a listar e somar o valor da parcela, igual ao restante do sistema (Contas a Receber, painel e IA).

Resultado: qualquer pergunta da Elen — ficha, "quanto eu devo", parcela do dia — responde sempre R$ 1.154,92, com as três parcelas listadas.

## Detalhes técnicos

- `supabase/functions/bubblewhats-webhook/index.ts` (atalho da ficha): remover o join `receivable_payments(amount_paid)` e o cálculo `open = amount - pago`; usar `amount` da parcela nas linhas e no total.
- `supabase/functions/_shared/monica-core.ts`: sem mudança de cálculo; apenas incluir no bloco de contexto um "TOTAL EM ABERTO" já somado, para a IA não errar a soma.
- Nenhuma alteração de dados nem migração de banco.
- Verificação: consultar o saldo da Elen pelos dois caminhos e confirmar R$ 1.154,92 nos dois.
