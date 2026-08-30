# Mônica parando de pedir comprovante

## O que está acontecendo

Nas conversas com a Padricia (Espaço Paty) a Mônica enviou hoje, às 16:17 (BRT), duas mensagens quase iguais pedindo o reenvio do comprovante:

- "Peço desculpas, PADRICIA, mas parece que o comprovante não chegou para mim. Você poderia reenviar, por favor?..."
- "Ah, querida! Desculpe, não localizei ele aqui. Você poderia reenviar, por favor?..."

O código já tem uma trava que deveria engolir exatamente esse tipo de frase (pedido de reenvio / "não recebi o comprovante") e deixar a Mônica em silêncio. Nos registros de execução de hoje não aparece nenhuma marca dessa trava atuando, o que indica que a versão publicada da função está desatualizada em relação ao código ou que a frase escapou pelas brechas do filtro. As duas respostas saíram com 40 milissegundos de diferença, ou seja, a mesma conversa foi respondida duas vezes.

## O que fazer

1. **Republicar as funções de WhatsApp** para garantir que a versão no ar seja a mesma do código, e confirmar pelo registro de execução que a trava aparece funcionando.
2. **Reforçar a trava de comprovante**: qualquer resposta gerada pela IA que mencione comprovante, recibo, "print" ou pagamento não localizado passa a ser descartada (silêncio), salvo a única frase autorizada — a instrução que acompanha a chave PIX. Hoje o filtro depende de combinações específicas de palavras e deixa passar variações como "não localizei ele aqui".
3. **Bloquear pedidos de reenvio em geral**: frases como "poderia reenviar", "manda de novo", "não apareceu aqui" viram silêncio, independentemente de citarem a palavra comprovante.
4. **Evitar resposta duplicada**: se já existir uma resposta enviada nessa conversa nos últimos segundos para a mesma mensagem recebida, a função não envia de novo.
5. **Verificação**: revisar o histórico da conversa da Padricia depois do ajuste e confirmar que nenhuma nova cobrança de comprovante saiu.

Quando o cliente enviar de fato um comprovante, o comportamento atual continua igual: o sistema analisa, salva na página Comprovantes e responde "Recebi seu comprovante, muito obrigada! Deus abençoe 🙏".

## Detalhes técnicos

- `supabase/functions/_shared/monica-core.ts`: ampliar `GUESS_REPLY_RE` (termos: comprovante, recibo, print, pagamento não identificado/localizado/consta; verbos de reenvio isolados) e aplicar `isGuessReply` também após os pós-processadores, não apenas sobre o texto bruto do modelo.
- `supabase/functions/bubblewhats-webhook/index.ts`: guarda de idempotência por `id` da mensagem do provedor antes de chamar a IA, evitando dupla resposta em reentrega do webhook.
- Redeploy de `bubblewhats-webhook` (e do módulo compartilhado que ele importa). Sem mudanças de banco nem de interface.
