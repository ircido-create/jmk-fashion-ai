# JULIANA MARCATTI NUNES ME não recebe cobrança

## Causa confirmada

Ela **está elegível**: tem 1 título vencido (R$ 350,00, venc. 25/08, pedido 6817), telefone cadastrado (5511946309568) e não está na lista de silêncio. A última cobrança dela foi em 30/07.

O problema é o **limite de 20 envios por rodada**:

- Hoje existem **45 títulos elegíveis** para cobrança.
- A rodada busca no máximo **20**, ordenados do vencimento **mais antigo para o mais novo**.
- Como os mais antigos continuam em aberto, eles ocupam as 20 vagas **todos os dias** — os registros nos últimos 10 dias mostram exatamente 20 envios por dia.
- Juliana é a 10ª da fila hoje, mas em dias anteriores ficava depois da posição 20, então nunca era alcançada.

Ou seja: quem vence mais recentemente fica "preso" atrás da fila dos atrasados antigos.

## O que será feito

1. **Aumentar o limite da rodada** de 20 para 60 envios por execução, cobrindo os 45 elegíveis de hoje com folga (com intervalo entre envios mantido para não sobrecarregar o WhatsApp).
2. **Rodízio justo na fila**: ordenar priorizando quem **há mais tempo não recebe cobrança** (último registro em `dunning_logs`), e só depois pelo vencimento. Assim, mesmo se um dia a fila passar do limite, ninguém fica esquecido — cada cliente entra na vez.
3. **Disparar uma rodada manual** logo após o ajuste e confirmar que Juliana recebeu.

## Detalhes técnicos

- `get_overdue_receivables_to_dunning`: adicionar `LEFT JOIN LATERAL` com o `max(sent_at)` de `dunning_logs` por título e ordenar por `ultimo_envio NULLS FIRST, due_date ASC`. Assinatura e colunas de retorno permanecem iguais (nenhuma mudança na edge function além do limite).
- `supabase/functions/dunning-cron/index.ts`: `p_limit` de 20 → 60. O delay de 200ms por envio mantém a rodada em ~15s para 60 mensagens, bem dentro do tempo da função.
- Sem alteração de horário (10:00 BRT), de texto das mensagens, nem das regras de 1 envio por título/dia, lista de silêncio e corte de 180 dias.
