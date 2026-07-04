## Diagnóstico

Verifiquei o banco: os produtos citados (VESTIDO LISTRADO TRICO e JAQUETA RAFAELA) estão com **quantidade = 1** neste momento, e só existem 2 vendas registradas (nenhuma delas dessas peças). Ou seja, o carrinho abandonado **não gravou nada** no estoque — não há trigger, edge function, nem código no `POS.tsx` que rode ao fechar/recarregar a página.

O que existe hoje no `POS.tsx` (e no `Sales.tsx`) é um problema **latente e perigoso** na hora de finalizar a venda: quando um item é adicionado ao carrinho, o app guarda `maxQty` = quantidade do estoque naquele instante. Ao finalizar, ele grava `quantity = maxQty − vendido`, **sobrescrevendo** o valor atual do banco. Se você abrir o PDV, deixar o carrinho aberto por um tempo, importar romaneio/editar estoque em outra aba e depois finalizar, esse `maxQty` fica desatualizado e pode reverter/zerar o estoque real.

Também notei que **VESTIDO LISTRADO TRICO tem 3 variações duplicadas** (todas 42 / UNICO, 1 peça cada). Isso confunde o PDV — ao vender 1, só uma linha é baixada e as outras 2 continuam aparecendo.

## Plano

### 1. Baixa de estoque atômica (correção principal)

Criar uma função no banco `public.decrement_variant_stock(variant_id uuid, qty int)` que:
- lê o `quantity` atual da variação,
- grava `GREATEST(0, quantity − qty)` na mesma linha,
- retorna o novo valor.

Assim a baixa sempre parte do valor **real** do banco, não de um `maxQty` que o navegador guardou minutos atrás.

Substituir em `src/pages/POS.tsx` e `src/pages/Sales.tsx` o trecho:

```ts
const newQty = Math.max(0, it.maxQty - it.quantity);
await supabase.from("product_variants").update({ quantity: newQty }).eq("id", it.variantId);
```

por uma chamada `supabase.rpc("decrement_variant_stock", { variant_id, qty })`, executada **somente** depois de `sales` + `sale_items` inserirem sem erro (comportamento que já existe).

### 2. Limpeza das variações duplicadas do VESTIDO LISTRADO TRICO

Consolidar as 3 linhas 42/UNICO em uma só com quantidade 3 (soma) e apagar as outras duas, para o PDV mostrar corretamente e a baixa atingir a única linha existente.

### 3. Verificação

Depois do deploy, abrir o PDV com VESTIDO TRICO / JAQUETA RAFAELA, fechar a página sem finalizar e reconferir o estoque no banco — deve continuar 1. Se você conseguir reproduzir o "zera ao fechar" mesmo assim, me avisa com o horário exato do teste que eu puxo os logs do banco naquele minuto.

## Escopo técnico

- Migração: cria `public.decrement_variant_stock(uuid, int)` com `SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE` para `authenticated` e `service_role`.
- Migração: `UPDATE` consolidando o vestido trico + `DELETE` das duplicatas.
- `src/pages/POS.tsx`: troca do bloco de baixa (linhas 358–363) por chamada RPC.
- `src/pages/Sales.tsx`: mesma troca (linhas 186–192).
- Nenhuma mudança em UI, RLS de outras tabelas, ou edge functions.
