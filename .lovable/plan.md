# Corrigir divergência no saldo da Elen (R$ 1.154,92 x R$ 1.054,92)

## O que está acontecendo

A Elen (ELEN CAMPOS LOURENCO DA SILVA) tem 3 parcelas em aberto:

```text
30/08/2026  Carteira (2/3)   R$ 400,00  vencida  — já pagou R$ 100,00 (parcial)
30/09/2026  Carteira (3/3)   R$ 414,92
30/10/2026  Carteira         R$ 340,00
```

Soma bruta = R$ 1.154,92. Descontando o pagamento parcial de R$ 100,00 = R$ 1.054,92.

Os dois números vêm de dois caminhos diferentes do atendimento:

- O atalho da "ficha" (resposta rápida) já desconta pagamentos parciais → R$ 1.054,92 (correto).
- O caminho da IA monta o contexto lendo só o valor original da parcela, sem olhar os pagamentos parciais → R$ 1.154,92 (errado).

Por isso a cliente recebe um valor e, minutos depois, outro.

## Correção

Fazer o contexto da IA usar o mesmo cálculo do atalho da ficha: valor em aberto = valor da parcela menos os pagamentos já registrados nela; parcelas totalmente quitadas por pagamentos parciais somados saem da lista.

Também reforçar no prompt que o valor a informar é sempre o saldo em aberto (já líquido de pagamentos), nunca o valor original da parcela.

Resultado: qualquer pergunta da cliente (ficha, "quanto eu devo", parcela do dia) responde R$ 1.054,92.

## Detalhes técnicos

- `supabase/functions/_shared/monica-core.ts`: na consulta de `accounts_receivable` incluir `receivable_payments(amount_paid)`; calcular `open = max(0, amount - soma(amount_paid))`; filtrar itens com `open <= 0`; expor `open` no bloco "DÍVIDAS PENDENTES" (e um TOTAL EM ABERTO já somado, para a IA não recalcular errado).
- Ajuste de texto no prompt (regra 3.1) para citar o valor em aberto e o total fornecido no contexto.
- Sem migração de banco; nenhum dado é alterado.
- Verificação: consultar o saldo da Elen pelos dois caminhos e conferir R$ 1.054,92 nos dois.
