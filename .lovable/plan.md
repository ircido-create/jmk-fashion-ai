
# Corrigir busca de fotos por descrição (cor + diminutivo)

## Problema

Quando a cliente diz "foto da blusinha marrom", a Monica entende o produto na conversa, mas não envia a foto. Com o nome exato ("BLUSA 7196 CAROL TRICO"), funciona.

## Causa

Em `supabase/functions/whatsapp-webhook/index.ts`, a função que cruza palavras-chave da mensagem com o catálogo procura apenas em `products.name`, `description`, `category` e `sku`. Dois problemas:

1. **"blusinha"** não casa com **"BLUSA"** (diminutivo não normalizado)
2. **"marrom"** está em `product_variants.color` — campo que nunca é pesquisado

## Mudanças

Tudo em `supabase/functions/whatsapp-webhook/index.ts`. Sem migrações, sem mudanças de frontend, sem mexer em config Meta.

### 1. Stemming pt-BR nas palavras-chave
Reduzir diminutivos/aumentativos antes de buscar:
- `blusinha` → `blus`
- `vestidinho` → `vestid`
- `shortinho` → `short`
- `saiona` → `sai`

Regra: remove sufixos `inha|inho|zinha|zinho|ona|ão` quando a raiz resultante tem ≥ 4 letras. As keywords passam a ser usadas como `ilike %raiz%`.

### 2. Buscar também em variantes
Adicionar uma segunda query em `product_variants` cruzando keywords contra `color` e `size`. Unir os `product_id` resultantes com os já encontrados via `products`.

### 3. Priorizar a variante que casa com a cor pedida
Hoje envia as primeiras variantes com imagem em qualquer ordem. Mudar para: ordenar primeiro as variantes cujo `color`/`size` casa com alguma keyword da mensagem; só depois as outras. Assim "marrom" envia a foto da variante MARROM, não da BRANCA.

## Resultado esperado

| Mensagem | Comportamento |
|---|---|
| "foto da blusinha marrom" | Envia foto da variante MARROM da BLUSA |
| "manda foto do vestidinho preto" | Stem `vestid%` + cor `preto` |
| "foto da BLUSA 7196 CAROL TRICO" | Continua funcionando como hoje |
| "tem em P?" (após foto enviada) | Continua usando produto em foco |
