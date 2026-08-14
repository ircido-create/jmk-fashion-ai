# Mônica não responde o Cido (5511947920404)

## O que foi verificado agora

- A conversa "Cido" (5511947920404) **não** está em atendimento humano, a IA **não** está pausada e o número **não** está na lista de bloqueio.
- **Nenhuma mensagem desse número chegou hoje** (14/08). A última entrada gravada nessa conversa foi em **13/08 às 00:28 (UTC)**. Ou seja: o pedido de cobrança/PIX feito hoje simplesmente **não chegou ao sistema** — não é a IA que decidiu não responder.
- Nas mensagens que chegaram hoje de outros contatos, o provedor está entregando com **atraso enorme**: mensagens enviadas pelos clientes às 15h/16h de 13/08 só foram entregues ao sistema às 02:23–02:26 de 14/08 (**10 a 15 horas de atraso**). O provedor está despejando uma fila acumulada.
- Nas últimas 14 horas há **apenas mensagens recebidas e nenhuma resposta enviada** — coerente com o fato de que o que chegou nesse lote foram reações/áudios antigos e assuntos não-financeiros (regra de silêncio, que fica como está).
- A função de configuração do aparelho registrou vários erros **502 Bad Gateway** do BubbleWhats no mesmo período.

Conclusão: o problema é **atraso/fila de entrega do BubbleWhats**, não a lógica da Mônica.

## Plano

1. **Medir o atraso real de entrega**
   Gravar em cada mensagem recebida a hora em que o cliente enviou (o provedor já manda esse dado) além da hora em que o sistema recebeu, para calcular a defasagem.

2. **Alerta de atraso na página WhatsApp + IA e no Dashboard**
   Se a média de atraso das últimas mensagens passar de 15 minutos, mostrar aviso: "As mensagens estão chegando com atraso de X horas — fila do provedor BubbleWhats". Assim o problema fica visível na hora, em vez de parecer que a IA travou.

3. **Mostrar o atraso na conversa**
   Nas conversas, quando uma mensagem tiver chegado com mais de 15 minutos de defasagem, exibir a hora real de envio junto com um selo "recebida com atraso".

4. **Reprocessar mensagens atrasadas com segurança**
   Quando uma mensagem financeira chegar com mais de 6 horas de atraso, a Mônica responde normalmente, porém iniciando com uma nota curta de que a mensagem chegou agora (evita resposta fora de contexto tipo "parcela vence hoje" para pedido de ontem).

5. **Botão "Reenviar/forçar sincronização"**
   Na página WhatsApp + IA, botão que reaplica a configuração de webhook no BubbleWhats (com as novas tentativas automáticas já implantadas), útil quando o provedor volta de um 502.

6. **Teste guiado**
   Depois de aplicar, peço que você mande "quanto eu devo" do 5511947920404 e eu confirmo, pelos registros, se a mensagem chegou e em quanto tempo — isolando definitivamente provedor x sistema.

## Detalhes técnicos

- Nova coluna `sent_at` (timestamptz) em `whatsapp_messages`, preenchida no `bubblewhats-webhook` a partir do campo `messageTimestamp` do payload (fallback: `timestamp`).
- Cálculo de defasagem: `received_at - sent_at`, exposto num indicador na página WhatsApp e num badge em `src/pages/Conversations.tsx`.
- Ajuste no `bubblewhats-webhook`: prefixo curto na resposta quando a defasagem for > 6h; sem mudança na regra de SILÊNCIO (assuntos não-financeiros continuam sem resposta).
- Reuso da função `bubblewhats-configure-groups` para o botão de sincronização.
- Nenhuma alteração no prompt financeiro da Mônica nem nos dados existentes.
