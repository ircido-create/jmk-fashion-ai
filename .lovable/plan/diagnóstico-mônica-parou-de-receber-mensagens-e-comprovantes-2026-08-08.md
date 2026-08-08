# Diagnóstico: Mônica parou de receber mensagens e comprovantes

## O que foi verificado agora

- A última mensagem recebida no sistema foi em **06/08/2026 às 11:21 (horário de Brasília)**. Depois disso, nada entrou — nem texto, nem imagem, nem comprovante.
- O endereço do webhook está **no ar e respondendo normalmente** (testado agora, retorna "ok").
- A configuração do WhatsApp no sistema está **ativa** e **sem registro de erro** (nenhuma falha gravada).
- Os registros de execução das funções nas últimas 48h estão **vazios** — ou seja, o BubbleWhats simplesmente **não está chamando** o sistema.

Conclusão: o problema não está no código nem no banco. A entrega de mensagens parou do lado do BubbleWhats — as duas causas prováveis são **aparelho/sessão desconectada** ou **URL de webhook perdida/desconfigurada** na conta BubbleWhats.

## Plano

1. **Criar uma função de diagnóstico do BubbleWhats** que consulta a API do provedor com as credenciais já salvas e retorna:
   - status da sessão do aparelho (conectado / desconectado / precisa reler QR Code);
   - URL de webhook atualmente registrada;
   - se o recebimento de grupos está ativo.
2. **Adicionar um painel "Diagnóstico da conexão" na página WhatsApp + IA**, com botão "Verificar conexão" mostrando em linguagem simples: aparelho conectado?, webhook correto?, última mensagem recebida há quanto tempo.
3. **Botão "Reconfigurar webhook"** que reenvia a URL correta ao BubbleWhats (aproveitando a função de grupos já existente), corrigindo o caso de configuração perdida.
4. **Alerta automático de inatividade**: se não houver mensagem recebida há mais de 6 horas, exibir aviso vermelho no topo da página WhatsApp e no Dashboard, indicando possível desconexão.
5. **Registro de falhas**: gravar em `whatsapp_config.last_error_at/last_error_message` sempre que a checagem detectar sessão caída, para histórico.

Se o diagnóstico apontar aparelho desconectado, a correção é reler o QR Code no painel do BubbleWhats — nesse caso o passo 2 vai dizer isso claramente na tela.

## Detalhes técnicos

- Nova função `supabase/functions/bubblewhats-status/index.ts` (verify_jwt padrão), usando `BUBBLEWHATS_TOKEN` e `BUBBLEWHATS_DEVICE_ID` já existentes.
- Consulta de "última mensagem recebida": `select max(created_at) from whatsapp_messages where direction='inbound'`.
- Alterações de UI apenas em `src/pages/WhatsApp.tsx` (novo card) e um aviso condicional em `src/pages/Dashboard.tsx`.
- Nenhuma alteração no fluxo da IA, nos prompts da Mônica ou nos dados existentes.
