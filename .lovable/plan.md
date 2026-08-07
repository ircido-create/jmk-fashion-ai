# Corrigir lentidão / travamento do sistema

## Diagnóstico (verificado agora)

O backend está saudável (banco no ar, 6% de disco, 6/60 conexões, 28,9 MB). O gargalo está na tela **Conversas**:

- Existem **347 conversas** e **16.022 mensagens**.
- Ao abrir Conversas, o app busca a lista e depois faz **uma consulta separada por conversa** para pegar a última mensagem — ou seja, **347 requisições em sequência** a cada carregamento. Isso trava a interface e dá a sensação de "não abre".
- Essa recarga completa é disparada **a cada nova mensagem recebida em tempo real** (e a cada mudança em qualquer conversa), multiplicando o problema quando o WhatsApp está movimentado.
- Confirmação no banco: essa consulta de "última mensagem" já foi executada **228.405 vezes**, somando ~272 segundos de tempo de banco — de longe a mais custosa do projeto.
- A tabela `whatsapp_messages` **não tem índice** por conversa/data, então cada uma dessas consultas varre a tabela inteira.
- Ao abrir uma conversa, o app carrega **todas** as mensagens dela de uma vez, sem limite.

## O que será feito

1. **Índice no banco**: criar índice em `whatsapp_messages (conversation_id, created_at DESC)` para que buscas por conversa fiquem instantâneas.
2. **Guardar a última mensagem na conversa**: adicionar uma coluna de prévia (`last_message_preview`) em `whatsapp_conversations`, preenchida automaticamente por gatilho quando chega/sai mensagem, e retroalimentada com os dados atuais. Assim a lista de conversas passa a ser **uma única consulta**, sem as 347 chamadas.
3. **Ajustar a tela Conversas** (`src/pages/Conversations.tsx`):
   - usar a prévia vinda da própria conversa (remove o laço N+1);
   - carregar apenas as **últimas 100 mensagens** da conversa aberta (com botão "carregar mais antigas");
   - no tempo real, atualizar só a conversa afetada em vez de recarregar a lista inteira, com proteção contra rajadas de mensagens.

## Detalhes técnicos

- Migração: `CREATE INDEX idx_wa_messages_conv_created ON public.whatsapp_messages (conversation_id, created_at DESC);`
- Migração: `ALTER TABLE public.whatsapp_conversations ADD COLUMN last_message_preview text;` + backfill via `DISTINCT ON` + trigger `AFTER INSERT ON whatsapp_messages` (SECURITY DEFINER, `search_path = public`) atualizando `last_message_preview` e `last_message_at`.
- Sem novas tabelas, então nenhum GRANT/RLS adicional é necessário; a coluna herda as políticas existentes.
- Frontend: `loadConversations` passa a ser um único `select`; `loadMessages` recebe `.order('created_at', { ascending: false }).limit(100)` e inverte no cliente; handler de realtime faz atualização incremental do item da lista.

## Fora do escopo

Nenhuma mudança em regras de negócio, IA/Mônica ou layout visual.
