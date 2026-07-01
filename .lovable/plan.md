## Objetivo
Ao importar um romaneio (PDF do fornecedor) em Estoque, extrair também as fotos dos produtos que estejam embutidas no próprio PDF e salvá-las como imagem principal do produto — **apenas** quando o produto for novo ou ainda não tiver foto (nunca sobrescreve).

## Como vai funcionar

1. Usuário abre Estoque → Importar Romaneio e envia o PDF (fluxo atual, sem mudança na UI).
2. Backend (`parse-romaneio`) roda em duas etapas dentro da mesma chamada:
   - **Etapa A — extração de dados (já existe)**: Gemini 2.5 Pro lê o PDF e retorna fornecedor, itens (SKU, nome, cor, tamanho, qty, custo) e parcelas.
   - **Etapa B — extração de imagens (novo)**: renderiza cada página do PDF em imagem (usando `pdfium` via WASM em Deno, ou fallback `pdf.js`) e pede ao Gemini para associar cada foto visível a um SKU da lista extraída na etapa A, retornando para cada SKU um recorte (bounding box em % da página + índice da página). Recortamos server-side com Canvas API, comprimimos em JPEG (máx 800px, ~85% qualidade) e subimos no bucket `product-images`.
3. Para cada produto processado, se `image_url IS NULL`, gravamos o public URL da foto extraída. Se já tiver foto, ignoramos.
4. Resposta da função ganha `photos_imported: N` e o toast em `Inventory.tsx` mostra "X fotos importadas".

## Detalhes técnicos

- **Renderização do PDF em Deno edge function**: usar `npm:pdfjs-dist` com `getDocument().getPage().render()` em um `OffscreenCanvas` (ou `npm:@napi-rs/canvas` compatível). Escala 1.5x para boa leitura de foto.
- **Segunda chamada Gemini** (`google/gemini-2.5-pro`) recebe:
  - Todas as páginas como `image_url` base64.
  - A lista de SKUs extraídos na etapa A como texto.
  - Tool call `associate_photos` com schema `{ associations: [{ sku, page_index, bbox: {x,y,w,h} }] }` (coords normalizadas 0-1).
- **Recorte + upload**: para cada associação, redesenhar a região no canvas, `toBlob('image/jpeg')`, `admin.storage.from('product-images').upload('romaneio/{sku}-{timestamp}.jpg', blob, { upsert: false })`, pegar public URL, `update products set image_url = ... where id = ? and image_url is null`.
- **Custo/tempo**: cada página adiciona ~1-3s. Limitar a 20 páginas para não estourar timeout de 150s da edge function.
- **Fallback silencioso**: se a etapa B falhar (PDF sem imagens, Gemini não achou correspondência, erro de render), a importação de dados **não** é afetada — só retorna `photos_imported: 0` e um `photos_warning` opcional.

## Arquivos afetados

- `supabase/functions/parse-romaneio/index.ts` — adicionar etapa B (render + associate + crop + upload + update).
- `src/pages/Inventory.tsx` — mostrar `photos_imported` no toast final.

## Fora de escopo

- Não altera o fluxo manual "Buscar imagem do fornecedor" (`SupplierImageSearch`) — continua disponível como antes.
- Não busca fotos externas na web (usuário escolheu extrair só do PDF).
- Não sobrescreve fotos existentes.
- Não extrai foto por variação (cor/tamanho) — só imagem principal do produto, já que romaneios normalmente têm uma foto por referência.
