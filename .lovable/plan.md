# Plano de Ajuste de Horário de Cobrança

O objetivo é garantir que o envio automático de cobranças ocorra rigorosamente às **10:00 da manhã (Horário de Brasília)**.

## Mudanças Técnicas

### 1. Configuração do Agendamento (Cron) no Backend
O servidor opera em UTC. O horário de Brasília (BRT) é **UTC-3**.
Para que a execução ocorra às 10:00 BRT, o agendamento deve ser definido para **13:00 UTC**.

- **Ação:** Criar ou atualizar a configuração do cron para a função `dunning-cron` usando o CLI do backend para disparar às `0 13 * * *`.

### 2. Ajuste na Lógica de "Já Enviado Hoje"
A função `dunning-cron` e a RPC `get_overdue_receivables_to_dunning` utilizam a data atual para evitar duplicidade. Como a execução cruzará a virada do dia em UTC (10:00 BRT = 13:00 UTC), precisamos garantir que a comparação de "hoje" leve em conta o fuso horário correto para não pular envios ou duplicá-los.

- **Ação:** Atualizar a RPC `get_overdue_receivables_to_dunning` para considerar `timezone('America/Sao_Paulo', now())::date` como o padrão de "hoje" (já implementado via migração).

### 3. Interface de Usuário
- **Ação:** Atualizar `src/pages/WhatsApp.tsx` para refletir o novo horário agendado, dando clareza ao usuário sobre quando o próximo ciclo ocorrerá (já implementado).

## Verificação
1. Validar via logs que a próxima execução agendada está para as 13:00 UTC.
2. Testar o botão de execução manual para garantir que a lógica de "já enviado hoje" respeita o fuso de Brasília.
