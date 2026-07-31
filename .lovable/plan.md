## Diagnóstico (confirmado)

Na conversa do número 5511969916627 ("agenda aberta cabelo bolo"), verifiquei no banco:

- A cliente pediu explicitamente: "Irmã Mônica me manda o pix pfv" (13:04) e "Qual seu pix?" (13:57).
- Nenhuma mensagem de saída (`outbound`) foi registrada nessa conversa.
- A conversa **não** está em atendimento humano (`ai_handoff = false`), o número **não** está silenciado, e a IA **não** está pausada globalmente.
- Os logs da função do webhook mostram, exatamente nesses horários, `[MONICA] SILENCIO detectado — não respondendo (assunto não-financeiro)`.

Causa: a regra atual "assistente exclusivamente financeira" faz o modelo devolver `[SILENCIO]` quando o histórico da conversa é sobre produto/venda — mesmo quando o pedido da vez é um pedido explícito de chave PIX, que é justamente um assunto financeiro. O pedido de PIX depende hoje 100% do julgamento do modelo, sem nenhuma rota garantida.

## O que fazer

### 1. Atalho determinístico de PIX no webhook
Espelhar o atalho de "ficha" que já existe em `bubblewhats-webhook`, agora para pedidos de PIX em conversas individuais (não grupo, sem atendimento humano, contato não silenciado, IA não pausada):

- Detectar por expressão: "pix", "manda o pix", "qual seu pix", "chave pix", "me envia o pix", "qr code" e variações com/sem acento.
- Buscar a chave configurada em `ai_settings` (`pix_key`, `pix_key_type`, `pix_recipient_name`).
- Responder no formato curto já definido: chave PIX + recebedor + "Me manda o comprovante quando pagar", com saudação "Amém" quando a mensagem tiver saudação religiosa.
- Se não houver chave configurada, responder que vai verificar com a equipe (sem inventar chave).
- Registrar a resposta como mensagem `outbound` na conversa, como o atalho de ficha já faz.

### 2. Blindar a regra de SILÊNCIO
Em `_shared/monica-core.ts`, deixar explícito na regra final que pedido de chave PIX, comprovante e valores de parcela **são sempre assunto financeiro** e nunca podem gerar `[SILENCIO]`. Isso cobre os casos em que o pedido chega com texto misturado (áudio transcrito, mensagem longa) e não bate na expressão do atalho.

### 3. Validação
- Reprocessar/testar o webhook com uma mensagem "me manda o pix pfv" para esse número de teste e confirmar nos logs que o atalho dispara e a resposta é enviada e gravada.
- Conferir que conversas em atendimento humano, contatos silenciados e IA pausada continuam sem resposta automática.

## Detalhes técnicos
- Arquivos: `supabase/functions/bubblewhats-webhook/index.ts` (novo fast-path, posicionado logo após o de ficha e antes da chamada ao modelo) e `supabase/functions/_shared/monica-core.ts` (ajuste do prompt final).
- Sem mudanças de banco de dados nem de interface.
