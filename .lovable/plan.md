# Lembrete de vencimento no dia

## Situação atual (verificada)

A rodada automática das 10:00 (BRT) só considera títulos **já vencidos** (`due_date < hoje`, status `vencido`). Hoje saíram 20 mensagens — todas de títulos atrasados, nenhuma para os 3 títulos que vencem hoje. Ou seja, **não existe lembrete de vencimento do dia**.

## O que será feito

Na mesma rodada das 10:00, antes de cobrar os atrasados, enviar um **lembrete amigável** para clientes com parcela vencendo naquele dia.

Texto do lembrete (tom da JMK, sem cobrança agressiva):

> Bom dia, {nome} 💕 Aqui é da JMK! Passando só para lembrar com carinho que sua parcela de R$ {valor} ({descrição}) vence hoje ({data}). Se precisar do Pix ou de qualquer ajuda, é só me chamar. Que Deus te abençoe! 🌸
>
> 👉🏻 Se já pagou, desconsidere este lembrete!

Regras iguais às da cobrança:
- Um envio por título por dia (sem repetição).
- Contatos da lista de silêncio ficam de fora.
- Cliente precisa ter telefone cadastrado.
- Cada envio também aparece na aba de Conversas.

O resumo da rodada passa a informar quantos foram lembretes e quantas foram cobranças de atraso.

## Detalhes técnicos

1. Nova função no banco `get_due_today_receivables_to_dunning(p_today, p_limit)`: retorna títulos com `due_date = p_today` e status `pendente`, com cliente que tenha telefone, excluindo `ai_blocked_contacts` e os que já têm `dunning_logs` de hoje para o mesmo título.
2. `supabase/functions/dunning-cron/index.ts`:
   - Após atualizar status para `vencido`, buscar também os vencendo hoje via a nova RPC.
   - Extrair o laço de envio atual em um helper reutilizado pelas duas listas (lembrete e cobrança), variando apenas o texto.
   - Contabilizar `lembretes_enviados` separado de `enviadas` no retorno e no `console.log`.
3. `dunning_runs` mantém as colunas atuais; o detalhamento de lembretes vai no campo de resumo/log (sem alteração de schema).
4. Nenhuma mudança de horário: continua 13:00 UTC / 10:00 BRT.
