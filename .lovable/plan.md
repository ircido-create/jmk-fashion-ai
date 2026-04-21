

## Buscar imagens dos produtos automaticamente do site do fornecedor

### Como vai funcionar

No formulário de cada produto (e no card da lista), um botão **"Buscar imagem do fornecedor"** vai:

1. Pegar o **nome do produto** + **fornecedor** já cadastrados
2. Procurar a peça no site oficial do fornecedor (ex: tatamartelo.com)
3. Mostrar **3-6 imagens candidatas** num modal
4. Você clica na que combina → ela é salva como imagem da variação (ou de todas as variações sem foto)

Funciona pra qualquer fornecedor — basta ter o nome dele preenchido no produto. O sistema descobre o site sozinho via busca; se quiser fixar, dá pra cadastrar o domínio do fornecedor.

### Fluxo visual

```text
[Produto: "Vestido Florença" | Fornecedor: "Tata Martelo"]
              │
              ▼  clica "Buscar imagem do fornecedor"
   ┌──────────────────────────────────────┐
   │  Buscando em tatamartelo.com…        │
   │  ┌────┐ ┌────┐ ┌────┐ ┌────┐         │
   │  │img1│ │img2│ │img3│ │img4│         │
   │  └────┘ └────┘ └────┘ └────┘         │
   │  [Aplicar a todas as variações]      │
   └──────────────────────────────────────┘
```

### O que vai mudar

**Banco**
- Nova tabela `supplier_sites` (opcional, manual): `supplier_name`, `domain` — pra fixar "Tata Martelo → tatamartelo.com" e evitar busca às cegas. Vem pré-populada com fornecedores que já estão no estoque (a confirmar com você no setup)
- Nova coluna `products.image_url` — imagem principal do produto (hoje só existe por variação)

**Backend (edge function nova: `find-product-image`)**
- Recebe: `product_name`, `supplier`
- Lógica:
  1. Lê `supplier_sites` pra achar o domínio. Se não achar, faz busca web (`site:fornecedor.com nome do produto`)
  2. Faz scrape da página de busca do site → pega URLs de produtos que batem com o nome
  3. Faz scrape da página do produto → extrai `og:image` + imagens grandes
  4. Devolve lista de até 6 URLs ranqueadas por similaridade do título
- Usa **Firecrawl** (connector) pra scraping confiável — funciona mesmo em sites com JS pesado tipo Shopify/VTEX que muita loja de moda usa

**Frontend (`src/pages/Inventory.tsx`)**
- Botão **"Buscar imagem do fornecedor"** no formulário de produto (ao lado de cada variação) e em cada card da lista
- Modal `SupplierImageSearch` mostra grid de candidatas com preview, badge de "match X%", e ações: aplicar à variação X, aplicar a todas, ou usar como imagem principal do produto
- Estado de loading + mensagem clara quando o site do fornecedor não é encontrado
- Imagens escolhidas são baixadas pelo backend e salvas no bucket `product-images` (não fica linkando pro CDN do fornecedor — evita quebrar se o site sair do ar)

### Pré-requisitos

- **Conector Firecrawl** precisa ser ligado no projeto (te peço a aprovação na próxima etapa). É o jeito mais robusto de raspar sites de loja sem cair em bloqueio anti-bot
- Se preferir não usar Firecrawl, dá pra usar `fetch` + parsing simples — funciona em sites estáticos mas falha em VTEX/Shopify (a maioria das marcas de moda). Te recomendo Firecrawl

### Detalhes técnicos

- Arquivos a criar: `supabase/functions/find-product-image/index.ts`, migração SQL (1 tabela + 1 coluna)
- Arquivos a editar: `src/pages/Inventory.tsx`, novo componente `src/components/SupplierImageSearch.tsx`
- Pipeline: Firecrawl `search` → Firecrawl `scrape` (formats: `links`, `html`) → extrair `og:image` e `<img>` em containers de produto → ranqueamento por Jaccard de tokens entre título do produto e título da página
- Download server-side da imagem escolhida → upload no bucket `product-images` → grava `image_url` no produto/variação
- RLS na nova tabela `supplier_sites`: staff lê/escreve, admin deleta (mesmo padrão das outras)
- Rate limit simples (5 req/min por usuário) na função pra evitar abuso/custo

