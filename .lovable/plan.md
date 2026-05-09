
# Pré-Venda Inteligente

Fluxo: vendedor abre câmera → fotografa etiqueta → IA preenche dados → confirma preço → seleciona cliente → finaliza. Se a peça não existe no estoque, é cadastrada como **rascunho** automaticamente.

## 1. Banco de dados

**Nova tabela `pre_sales`**
- `customer_id`, `seller_id`, `status` (enum), `total`, `discount`, `notes`, `whatsapp_sent_at`

**Nova tabela `pre_sale_items`**
- `pre_sale_id`, `product_id` (nullable até virar real), `variant_id`, `supplier`, `code`, `description`, `color`, `size`, `quantity`, `unit_price`, `subtotal`, `photo_url`, `raw_ocr` (jsonb)

**Enum `pre_sale_status`**: `aguardando_aprovacao`, `aguardando_compra`, `em_compra`, `recebido`, `pronto_entrega`, `finalizado`, `cancelado`

**Alteração em `products`**: adicionar coluna `is_draft boolean default false` para marcar produtos criados pela pré-venda que ainda precisam revisão.

**Bucket de storage**: `pre-sale-labels` (privado) para guardar a foto da etiqueta.

RLS: staff (admin/vendedor) CRUD; admin deleta.

## 2. Edge function `scan-label`

Recebe a imagem da etiqueta (base64), chama **Lovable AI Gateway** com `google/gemini-2.5-flash` (vision) e devolve JSON estruturado:

```json
{ "supplier": "...", "code": "...", "description": "...",
  "color": "Preto", "size": "M", "barcode": "...",
  "reference": "...", "category": "...", "brand": "...",
  "suggested_price": null, "confidence": 0.92 }
```

Prompt instrui:
- normalizar tamanhos (PP/P/M/G/GG/XG/34-56/único)
- expandir abreviações de cor (PT→Preto, BR→Branco, AZ→Azul, ROS→Rosa, etc.)
- corrigir erros comuns de OCR
- responder **apenas** JSON via `Output.object` (zod schema)

Após retorno, função busca em `products`/`product_variants` por código, SKU ou descrição similar e devolve `match` (existente vs novo).

## 3. Frontend — `/pre-vendas` (lista) e `/pre-vendas/nova`

**Lista** (`src/pages/PreSales.tsx`)
- Filtros: período, status, cliente, vendedor
- Cards com cliente, total, status (badge colorido), data
- Botão "+ Nova Pré-Venda"

**Nova/Edição** (`src/pages/PreSaleForm.tsx`) — UI mobile-first, botões grandes:
1. Header com cliente (busca rápida por nome/telefone/CPF, "criar novo" inline)
2. Botão grande **"📷 Escanear Etiqueta"** → abre `<input type="file" accept="image/*" capture="environment">`
3. Loader inteligente enquanto IA processa (com vibração `navigator.vibrate` + som curto)
4. Modal de confirmação com campos pré-preenchidos:
   - Se **achou no estoque**: mostra foto, descrição, preço, saldo; pede só quantidade
   - Se **não achou**: formulário com fornecedor/código/descrição/cor/tamanho + **preço de venda obrigatório** + checkbox "Cadastrar como rascunho no estoque" (default ligado)
5. Lista de itens adicionados (foto, descrição, cor/tamanho, qtd, subtotal, swipe/botão para remover, editar quantidade/desconto/observação)
6. Rodapé fixo: total + botão **Salvar pré-venda**
7. Após salvar: ações **Enviar no WhatsApp** (gera texto formatado com itens e abre `wa.me/<telefone>?text=...`), **Gerar PDF**, **Mudar status**

**Componente `LabelScanner`** isolado (reutilizável).

## 4. Conversão

Na tela de detalhe da pré-venda, botão **"Converter em Venda"**:
- valida que todos os itens têm `product_id` real (se algum estiver rascunho, abre passo para confirmar/ajustar produto + saldo)
- cria registro em `sales` + `sale_items` (reusa lógica de POS) e marca pré-venda como `finalizado`

## 5. Sidebar e rotas

- Adicionar item "Pré-Vendas" (ícone `ScanLine`) no `AppSidebar.tsx`
- Registrar `/pre-vendas` e `/pre-vendas/nova` (e `/pre-vendas/:id`) no `App.tsx`

## 6. Detalhes técnicos

- **OCR/IA**: Lovable AI via edge function (sem chave do usuário). Modelo `google/gemini-2.5-flash` com `Output.object` (zod) para JSON estrito.
- **Câmera**: `<input capture="environment">` — funciona em Android/iOS PWA sem build nativo. Foto é redimensionada client-side (max 1600px) antes de enviar para reduzir latência/custo.
- **Match de produto**: trigram/ILIKE em `products.sku`, `products.name`, `product_variants.sku`. Retorna top-3 sugestões; vendedor confirma.
- **Produto rascunho**: insere em `products` com `is_draft=true`, `active=true`, `cost=0`, `low_stock_threshold=0`; cria `product_variants` com `quantity=0`. Aparece no estoque com badge "Rascunho" para o admin revisar depois.
- **Offline / autosave**: salva o rascunho da pré-venda no `localStorage` a cada mudança; ao voltar online sincroniza.
- **PDF**: usa o mesmo padrão de `src/lib/financePdf.ts`.
- **WhatsApp**: monta texto com itens + total e abre `https://wa.me/<phone>?text=<encoded>`.

## 7. Dashboard (fase 2, mesma página `/pre-vendas`)

Cards no topo: total de pré-vendas no período, valor total, ticket médio, taxa de conversão (finalizado / total), top 5 fornecedores, top 5 produtos.

## 8. Fora deste escopo (sugestões para depois)

- App nativo via Capacitor (foco/flash dedicados)
- Aprovação por link público do cliente
- Sincronização offline completa com fila de retries
- Leitura de código de barras nativo (BarcodeDetector API) como complemento ao OCR

---

**Entregáveis nesta implementação:**
1. Migração SQL (tabelas + enum + bucket + RLS + coluna `is_draft`)
2. Edge function `scan-label`
3. Páginas `PreSales.tsx`, `PreSaleForm.tsx`, `PreSaleDetail.tsx`
4. Componente `LabelScanner.tsx`
5. Sidebar + rotas
6. Badge "Rascunho" no Inventory
