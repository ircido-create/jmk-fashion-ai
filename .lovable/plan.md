## Diagnóstico (confirmado no banco e no código)

- A cliente WILLIANE BARROS MONTEIRO DE SOUZA (5511954115772) tem **6 parcelas pendentes = R$ 1.012,00** (vencimentos 10/08, 10/09 e 10/10 de 2026). A conversa dela existe com esse mesmo telefone.
- A mensagem foi "Depois me manda minha conta". O atalho determinístico de ficha no webhook usa a expressão `\b(ficha|extrato|minhas parcelas|quais parcelas|carnê)\b` — **"conta" / "minha conta" não bate**, então o atalho não disparou.
- Sem o atalho, a resposta veio do modelo, que segue a Regra 3 do prompt: "Se NÃO houver parcela vencendo hoje, responda APENAS: 'No momento não encontramos nenhuma parcela com vencimento para hoje…'". Como nenhuma parcela vence hoje, o modelo devolveu exatamente essa frase — mesmo com as pendências no contexto.

Ou seja: nada de dado faltando; é a expressão do atalho estreita demais + a Regra 3 sendo aplicada até quando o cliente pede a conta.

## O que fazer

### 1. Ampliar o atalho de ficha no webhook
Em `supabase/functions/bubblewhats-webhook/index.ts`, expandir a expressão para cobrir os pedidos reais de extrato, incluindo variações com/sem acento:
- "minha conta", "minhas contas", "me manda a conta", "quanto eu devo", "quanto estou devendo", "meu saldo", "saldo devedor", "meu débito/débitos", "o que eu devo", "quanto falta pagar", "quanto ficou", "valores em aberto", "parcelas em aberto", "pendências".
- Manter as guardas atuais: não dispara em grupo, em atendimento humano, com contato silenciado ou IA pausada.
- Resposta continua a mesma já implementada: lista de parcelas em aberto com vencimento + total.

### 2. Corrigir a Regra 3 do prompt
Em `supabase/functions/_shared/monica-core.ts`, deixar a Regra 3 válida **apenas para cobrança espontânea** (quando a Mônica inicia o contato). Quando o cliente pergunta sobre conta/saldo/parcelas, a resposta obrigatória passa a ser a lista de pendências do bloco "DÍVIDAS PENDENTES" com valores, vencimentos e total — e a frase "nenhuma parcela com vencimento para hoje" fica proibida nesse caso. Só responder que não há nada em aberto quando o bloco estiver realmente vazio.

### 3. Evitar resposta duplicada
No print aparecem duas respostas seguidas (14:05). Vale confirmar nos logs se foram duas mensagens de entrada distintas; se for reentrega do mesmo evento, tratar com deduplicação pelo ID da mensagem do webhook.

### 4. Validação
- Reenviar "depois me manda minha conta" pelo número de teste e conferir nos logs que o atalho dispara e a ficha com R$ 1.012,00 é enviada e gravada como mensagem de saída.
- Conferir que conversas em atendimento humano, contatos silenciados e IA pausada continuam sem resposta automática.

## Detalhes técnicos
Arquivos: `supabase/functions/bubblewhats-webhook/index.ts` (expressão do atalho + possível dedupe) e `supabase/functions/_shared/monica-core.ts` (Regra 3). Sem mudanças de banco nem de interface.
