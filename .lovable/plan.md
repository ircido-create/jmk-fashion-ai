## Objetivo
Permitir importar **vários romaneios (PDFs) de uma vez** em Estoque, detectando e pulando automaticamente os que já foram importados anteriormente.

## Como vai funcionar

1. Em Estoque → Importar Romaneio, o campo de arquivo passa a aceitar **múltiplos PDFs** (multi-select).
2. Ao confirmar, o front processa os PDFs em fila (um por vez, para não estourar timeouts nem créditos da IA):
   - Calcula o **hash SHA-256** do PDF localmente.
   - Chama `parse-romaneio` normalmente.
   - Após extrair os dados, valida duplicidade no servidor (ver abaixo).
3. Ao final, exibe um resumo único no toast: `X romaneios importados, Y pulados (duplicados), Z com erro`, listando os arquivos pulados/com erro em um pequeno relatório expansível.

## Detecção de duplicidade (regra: hash OU fornecedor+total+itens)

Nova tabela `imported_romaneios` guarda o histórico do que já entrou:

```text
imported_romaneios
  id, file_hash (unique), supplier, total, items_count,
  storage_path, filename, imported_by, created_at
```

Na `parse-romaneio`, antes de inserir produtos/contas:

1. Se existir linha com o mesmo `file_hash` → duplicado (pular).
2. Se existir linha com mesmo `supplier` + mesmo `total` (tolerância de R$ 0,01) + mesmo `items_count` → duplicado (pular).
3. Caso contrário, prossegue com a importação e no final grava a linha em `imported_romaneios` (na mesma transação lógica).

Quando duplicado, a função retorna `{ ok: true, skipped: true, reason: "hash" | "supplier_total_items", existing: {...} }` sem tocar em produtos/estoque/contas.

## Arquivos afetados

- **Migração**: cria `imported_romaneios` com RLS (authenticated pode ler/inserir; select all) e índice em `file_hash`.
- `supabase/functions/parse-romaneio/index.ts`: aceita `file_hash` no body, checa duplicidade antes de processar, grava registro ao final da importação bem-sucedida, retorna `skipped`.
- `src/pages/Inventory.tsx`: input `multiple`, loop sequencial, cálculo de hash com `crypto.subtle.digest`, agregação de resultados, toast final com resumo + lista de pulados.

## Fora de escopo

- Não muda o fluxo de extração de fotos (`importRomaneioPhotos`) — continua rodando por PDF importado com sucesso.
- Não expõe tela de histórico de romaneios importados (fica só a tabela no banco; pode virar tela depois).
- Não paraleliza chamadas à IA (fila sequencial para respeitar rate limit).
