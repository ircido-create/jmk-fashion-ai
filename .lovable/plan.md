## Problema

Analisando os logs da última importação, identifiquei duas causas distintas:

### 1. "Sem itens" falso (Gemini retorna lista vazia)
Em 4 arquivos os logs mostram `items:[]` mas com `total` e `supplier` preenchidos (ex.: `total:169.9`, `total:589.8`, `total:319.9`, `total:203.92`). O Gemini 2.5 Pro ocasionalmente devolve o array vazio mesmo quando o PDF tem itens visíveis — geralmente em PDFs com layout de grade ou primeira página só de cabeçalho. Hoje quando isso acontece o arquivo é marcado como `skip: no_items` e nunca mais é tentado.

### 2. Duplicidade falsa
A regra atual bloqueia como duplicado quando **fornecedor + total + quantidade de itens** batem. Como você tem muitos romaneios pequenos do mesmo fornecedor (Tatá Martello), é comum dois PDFs diferentes terem, por exemplo, `total: 319.90` e `items_count: 1` — e o segundo é rejeitado erroneamente. O `file_hash` (SHA-256) já é 100% seguro contra duplicidade real; o segundo critério está causando mais dano do que ajuda.

## Correções propostas

### Em `supabase/functions/parse-romaneio/index.ts`

1. **Retry automático quando a IA devolve `items:[]`**
   - Se a primeira chamada ao Gemini 2.5 Pro voltar sem itens mas com `total > 0`, refazer a chamada com um prompt reforçado ("Este romaneio contém produtos. Extraia TODAS as linhas da tabela de itens, mesmo que estejam em grade de tamanhos") — até 2 tentativas.
   - Se ainda assim vier vazio, tentar fallback com `google/gemini-2.5-flash` (às vezes um modelo enxerga o layout onde o outro falha).
   - Só marcar `skip: no_items` depois de esgotar as tentativas.

2. **Remover a dedup por fornecedor + total + itens_count**
   - Manter apenas a dedup por `file_hash` (que é matematicamente à prova de falso positivo — dois PDFs idênticos byte-a-byte).
   - Se preocupação com PDFs re-gerados pelo fornecedor com bytes diferentes mas conteúdo igual, deixo comentário no código; podemos reintroduzir depois com uma chave mais forte (fornecedor + total + primeiro SKU + primeira data de vencimento).

3. **Devolver contagem de tentativas no response** para diagnóstico ("recuperado em 2ª tentativa"), exibido no relatório da modal.

### Em `src/pages/Inventory.tsx`

- Ajustar a legenda do item pulado para deixar claro quando foi por hash idêntico (100% duplicado) vs. quando a IA não conseguiu ler — hoje ambos aparecem como "⏭️".
- Botão "Tentar de novo os que falharam" no fim do relatório, que reenvia apenas os arquivos com status `err` ou `skip:no_items` (não os `skip:hash`, esses são realmente duplicados).

## Como testar depois

1. Zerar `imported_romaneios` novamente.
2. Reenviar o lote de 28.
3. Verificar no relatório: os 4 que antes vieram vazios devem entrar; os que antes eram "duplicados" falsos também.
4. Se restar algum como `no_items` real, usar o botão "Tentar novamente" — na 2ª rodada o Gemini costuma acertar.

## Fora deste plano

Não vou mexer em outras Edge Functions nem no fluxo de fotos do romaneio — é só o parser e a UI de progresso.