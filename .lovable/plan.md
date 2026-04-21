

# Importar romaneios + Upload de PDF na aba Produtos

## Parte 1 — Importar os 2 romaneios anexados

### Regra de preço
- `cost` = valor do romaneio (ex.: 239,90)
- `price` = `cost × 2`, **arredondado para cima ao inteiro mais próximo** (ex.: 239,90 → 480; 167,94 → 336; 50,00 → 100)

### Fornecedor 1 — Tatá Martello (09/04/2026)
**Conta a pagar:** R$ 3.411,41 — venc. 09/04/2026 — à vista — "Romaneio Lancto 0007 — 21 peças"

**17 variações em 14 produtos** (SKU base = código do romaneio):

| SKU | Produto | Cor | Tam | Qtd | Custo | Preço |
|---|---|---|---|---|---|---|
| 05705 | VESTIDO 5705 TAYLANE | VERDE | G | 1 | 239,90 | 480 |
| 05705 | VESTIDO 5705 TAYLANE | ROSA | GG | 1 | 239,90 | 480 |
| 05712 | VESTIDO 5712 MARILZA | ROSA | M | 1 | 259,90 | 520 |
| 05712 | VESTIDO 5712 MARILZA | CRU | PP | 1 | 259,90 | 520 |
| 05774 | VESTIDO 5774 PAULINE | PINK | GG | 1 | 249,90 | 500 |
| 05788 | VESTIDO 5788 MAURA | AZUL | PP | 1 | 229,90 | 460 |
| 05929 | VESTIDO 5929 NUBIA | PINK | G | 1 | 229,90 | 460 |
| 06291 | VESTIDO 6291 KEYLA | VERMELHO | P | 1 | 199,90 | 400 |
| 06291 | VESTIDO 6291 KEYLA | VERMELHO | M | 1 | 199,90 | 400 |
| 06542 | VESTIDO 6542C ROSIMEIRE | BEGE | P | 1 | 299,90 | 600 |
| 06566 | CONJUNTO 6566 JOICE | AMARELO | G | 1 | 199,90 | 400 |
| 06566 | CONJUNTO 6566 JOICE | AMARELO | GG | 1 | 199,90 | 400 |
| 06566 | CONJUNTO 6566 JOICE | AZUL | M | 1 | 199,90 | 400 |
| 06573 | PIJAMA 6573 (CAMISOLA/KIMONO) | ROSA | M | 1 | 229,90 | 460 |
| 06826 | VESTIDO 6826 POLIANA | MARROM | G | 1 | 239,90 | 480 |
| 07196 | BLUSA 7196 CAROL TRICO | MARROM | UN | 3 | 139,90 | 280 |
| 07197 | VESTIDO 7197 ÉLIDA TRICO | MARROM | UN | 3 | 239,90 | 480 |

### Fornecedor 2 — Clara Neve / KAULY (Ticket 6.329, 20/04/2026)
**Conta a pagar (6 parcelas):** 6× R$ 379,22 — venc. 20/05, 19/06, 19/07, 18/08, 17/09, 17/10/2026

**12 variações em 7 produtos** (tamanhos numéricos):

| SKU | Produto | Cor | Tam | Qtd | Custo | Preço |
|---|---|---|---|---|---|---|
| 03669 | VESTIDO DET BOTÃO | BRANCO | 40 | 1 | 80,00 | 160 |
| 04128 | CHEMISSIE RENDA | VERDE | 46 | 1 | 100,00 | 200 |
| 04338 | VESTIDO LADY LIKE EM VOIL | AZUL | 38 | 1 | 179,94 | 360 |
| 04428 | VESTIDO MAXI EM SEDA ESTAMPADO | ESTAMPADO | 48 | 1 | 269,90 | 540 |
| 04324 | CHEMISSIE COM RECORTES ELÁSTICOS | CREME | 38 | 1 | 167,94 | 336 |
| 04324 | CHEMISSIE COM RECORTES ELÁSTICOS | CREME | 40 | 1 | 167,94 | 336 |
| 04187 | CHEMISSIE COLETE | BRANCO E PRETO | 40 | 1 | 50,00 | 100 |
| 04187 | CHEMISSIE COLETE | BRANCO E PRETO | 42 | 1 | 50,00 | 100 |
| 04187 | CHEMISSIE COLETE | BRANCO E PRETO | 46 | 1 | 50,00 | 100 |
| 04433 | VESTIDO LONGO EM TULE ESTAMPADO | ESTAMPADO | 42 | 2 | 289,90 | 580 |
| 04433 | VESTIDO LONGO EM TULE ESTAMPADO | ESTAMPADO | 44 | 1 | 289,90 | 580 |
| 04433 | VESTIDO LONGO EM TULE ESTAMPADO | ESTAMPADO | 46 | 1 | 289,90 | 580 |

### Como vou inserir
- `products`: upsert por SKU. Se já existir, mantém o produto e só agrega novas variantes.
- `product_variants`: se a combinação SKU+cor+tamanho já existir, **soma** a quantidade; senão cria.
- `accounts_payable`: 1 lançamento Tatá + 6 parcelas KAULY, todos `pendente`.

## Parte 2 — Upload de romaneio na aba Produtos (Estoque)

Adicionar um botão **"Importar romaneio (PDF)"** no header da página `Estoque`, ao lado de "Novo produto".

### Fluxo
1. Usuário clica → abre dialog → seleciona PDF
2. Upload para um bucket de Storage `romaneios` (privado, RLS por staff)
3. Frontend chama edge function `parse-romaneio` enviando o caminho do arquivo
4. Edge function:
   - Baixa o PDF do Storage
   - Envia para **Lovable AI** (`google/gemini-2.5-pro`, ótimo em PDF + tabelas + raciocínio) com prompt estruturado pedindo JSON: `{ supplier, total, installments[], items[{sku, name, color, size, quantity, cost}] }`
   - Aplica margem 100% arredondada pra cima → `price`
   - Faz upsert de produtos/variantes (mesma lógica da Parte 1)
   - Cria conta(s) a pagar conforme parcelamento extraído
   - Retorna resumo: `{ products_created, variants_added, payable_amount, installments_created }`
5. Frontend mostra toast com o resumo e recarrega a lista

### Componentes/arquivos novos
- **Migração SQL**: criar bucket `romaneios` (privado) + policies (staff insere, staff lê próprios uploads)
- **Edge function** `supabase/functions/parse-romaneio/index.ts` — usa `LOVABLE_API_KEY` (já existe), service role para gravar produtos/variantes/conta a pagar
- **`src/pages/Inventory.tsx`**: botão "Importar romaneio" + dialog de upload + chamada à edge function

### Detalhes técnicos
- Modelo: `google/gemini-2.5-pro` via Lovable AI Gateway (suporta PDF nativamente, melhor para tabelas com colunas variáveis como as do KAULY)
- Prompt instrui a IA a:
  - Identificar fornecedor (CNPJ/Razão Social do cabeçalho)
  - Extrair condição de pagamento (à vista vs. parcelado, datas)
  - Para cada linha: SKU base (sem sufixo de cor), nome, cor, tamanho, quantidade, custo unitário
  - Validar totais (soma de itens deve bater com total do romaneio)
- Resposta da IA em JSON estruturado (response_format json_object)
- Tratamento de erro: se a IA não conseguir parsear ou totais não baterem, retorna erro com mensagem clara — nada é gravado
- Idempotência: as próximas execuções do mesmo PDF vão somar quantidades (mesma lógica da Parte 1) — se quiser evitar reimportação, posso adicionar uma tabela `romaneios_imported` com hash do arquivo (não vou adicionar agora, mas fica como sugestão).

## Resultado

Após aprovação:
- 7 lançamentos novos em **Contas a Pagar** (R$ 5.686,73 total)
- 24 variantes novas em **Estoque** (34 peças, todas com preço = custo × 2 arredondado pra cima)
- Aba **Estoque** ganha botão "Importar romaneio" — você anexa o PDF e o sistema faz tudo sozinho

