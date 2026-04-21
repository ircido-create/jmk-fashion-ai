

# Corrigir mensagens não aparecendo nas conversas

## O bug encontrado

O enum `message_direction` no banco aceita apenas `'inbound'` e `'outbound'`, mas o código está inserindo `'in'` e `'out'`. Cada `INSERT` falha silenciosamente porque o resultado nunca é verificado — por isso as **conversas são criadas** (sem erro de enum lá), mas **nenhuma mensagem é salva**, deixando o histórico vazio mesmo após o cliente enviar.

Confirmei consultando o banco:
- `whatsapp_conversations`: 2 registros recentes
- `whatsapp_messages`: 0 registros
- `pg_enum` para `message_direction`: `inbound`, `outbound`

## Mudanças

1. **`supabase/functions/whatsapp-webhook/index.ts`**
   - Trocar `direction: "in"` → `"inbound"` (mensagem recebida do cliente)
   - Trocar `direction: "out"` → `"outbound"` (resposta da IA)
   - Adicionar verificação de erro no `insert` com `console.error` para evitar falhas silenciosas no futuro

2. **`supabase/functions/whatsapp-send/index.ts`**
   - Trocar `direction: "out"` → `"outbound"` (envio manual do operador)

3. **`src/pages/Conversations.tsx`**
   - Atualizar o tipo `Message["direction"]` para `"inbound" | "outbound"`
   - Ajustar a lógica de alinhamento dos balões (`outbound` à direita, `inbound` à esquerda)

4. **Reprocessar conversas órfãs**
   - As 2 conversas que já existem (com `5511941254115` e `16315551181`) ficaram sem histórico — vou deixar como estão (próximas mensagens vão aparecer normalmente). O cliente só precisa mandar uma nova mensagem.

5. **Re-deploy** das duas edge functions corrigidas.

## Resultado esperado

Próxima mensagem do cliente → grava como `inbound` → aparece em tempo real no painel à esquerda. Resposta da IA grava como `outbound` → aparece à direita. Envio manual pelo operador também grava `outbound` corretamente.

