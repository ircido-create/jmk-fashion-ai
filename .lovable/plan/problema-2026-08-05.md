## Problema

A frase "Me fala o tamanho e a cor que você gostaria pra eu separar aqui." não vem do modelo de IA — está fixa no webhook, na automação de reação a status (`supabase/functions/bubblewhats-webhook/index.ts`, bloco "REAÇÃO A STATUS"). Quando a cliente curte/reage a um status nosso, o webhook envia essa mensagem (ou a variante "essa peça já esgotou") automaticamente.

Isso contraria a regra atual de a Mônica ser exclusivamente financeira.

## O que fazer

Desativar por completo a resposta automática em reações a status:

- Remover o envio das duas mensagens automáticas (disponível e esgotado) e a verificação de estoque associada.
- A reação continua sendo registrada normalmente na aba de Conversas, para você responder manualmente quando quiser.
- Não gravar mais mensagem de saída nem incrementar não-lidas por causa da reação.
- O webhook segue respondendo `ok` ao provedor, sem disparar a IA para esse evento.

Nenhuma outra automação é afetada: ficha/extrato, PIX e comprovante continuam funcionando igual.

## Detalhes técnicos

Arquivo único: `supabase/functions/bubblewhats-webhook/index.ts` — bloco de `reactionMessage` (aprox. linhas 504-578). Sem mudanças de banco nem de interface. A tabela `status_reaction_sent` deixa de ser usada nesse fluxo.
