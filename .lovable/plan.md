# Plano de Otimização de Performance

Fiz um diagnóstico rápido antes de propor mudanças. Segue o resultado e o que faz sentido aplicar **agora** (sem quebrar nada) vs. o que **não vale o custo/risco** neste estado do projeto.

---

## 1) Diagnóstico atual

**Banco de dados (Lovable Cloud):**
- Tabelas são pequenas: `accounts_receivable` 646, `customers` 330, `product_variants` 132, `products` 70, `accounts_payable` 64, `sales` 6, `sale_items` 4. Nenhuma perto de "milhares".
- Consultas mais lentas rodam em **9–30 ms**. Não há query lenta real. Índices FK principais já existem (`sale_items.sale_id`, `receivable_payments.receivable_id`, `pre_sales.customer_id`, `customers.tax_id`, `customers(lower(nickname))`).
- Faltam apenas 3 índices úteis para o padrão de ordenação/filtro atual (ver seção 3).

**Front-end:**
- `src/App.tsx` importa **as 23 páginas de forma estática** — todo o app entra no bundle inicial. Esse é o maior gargalo real de "tempo até a tela".
- Páginas grandes: `Receivable.tsx` (1325 linhas), `POS.tsx` (1029), `Conversations.tsx` (999), `Reports.tsx` (717), `Inventory.tsx` (676).
- Várias páginas usam `fetchAll` (paginação até acabar) para tabelas hoje pequenas — vai escalar mal, mas ainda não é problema.

**Conclusão honesta:** o app **não está lento por causa de banco**. Está lento (potencialmente) por causa de bundle inicial. Vou focar aí — é onde há ganho real e baixo risco.

---

## 2) O que vou fazer (alto impacto, baixo risco)

### A. Code-splitting por rota (impacto alto)
- Trocar todos os `import Page from ...` em `src/App.tsx` por `lazy(() => import(...))`.
- Envolver `<Routes>` em `<Suspense fallback={<PageSkeleton/>}>`.
- Criar `src/components/layout/PageSkeleton.tsx` para não mostrar tela em branco.
- **Ganho estimado:** bundle inicial cai ~60–75% (só Dashboard + libs comuns), TTI e LCP caem proporcionalmente em 3G/mobile.

### B. QueryClient com defaults saudáveis
- Configurar `staleTime: 30s`, `gcTime: 5min`, `refetchOnWindowFocus: false`, `retry: 1`.
- Efeito: menos refetch redundante quando o usuário volta pra aba.

### C. Debounce nas buscas (300ms)
- Criar hook `useDebouncedValue` e aplicar em `Customers`, `Sales`, `Inventory`, `Receivable`, `Payable`, `Conversations`, `PreSales`.
- Hoje o filtro roda a cada tecla; com 300+ registros já dá pra sentir.

### D. Índices que faltam no Postgres
```sql
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_customer_due
  ON public.accounts_receivable (customer_id, due_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_status_due
  ON public.accounts_receivable (status, due_date);
CREATE INDEX IF NOT EXISTS idx_accounts_payable_status_due
  ON public.accounts_payable (status, due_date);
CREATE INDEX IF NOT EXISTS idx_sales_date
  ON public.sales (sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer
  ON public.sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON public.product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_customers_name_lower
  ON public.customers (lower(name));
```
**Ganho:** invisível hoje, mas evita degradação futura quando as tabelas crescerem.

### E. Limpeza de imports mortos
- Rodar `rg` por `import` não usado nas 5 páginas maiores e remover. Mudança cosmética; sem impacto funcional.

---

## 3) O que **NÃO** vou fazer agora (e por quê)

- **Virtualização de listas** (`react-window`): útil só acima de ~500 itens visíveis. Nenhuma tela chega perto. Adicionar dependência e reescrever renderização por prevenção não compensa.
- **`React.memo` / `useMemo` / `useCallback` massivos:** sem profiler mostrando re-render caro, virariam ruído. Aplico pontualmente quando/se aparecer.
- **Refatorar `fetchAll` para paginação server-side:** as tabelas ainda cabem em memória sem dor. Faço quando `customers`/`accounts_receivable` passarem de ~2k linhas.
- **Web workers para relatórios:** `Reports.tsx` hoje agrega em memória sem travar. Fazer isso só quando houver > 10k linhas por chamada.
- **Reescrever RLS:** políticas atuais estão OK; mexer sem necessidade é risco de regressão de segurança.
- **Comprimir imagens automaticamente:** as imagens são de produto vindas do storage/URL do usuário; não são bundled assets.

---

## 4) Detalhes técnicos

**Arquivos a editar:**
- `src/App.tsx` — lazy routes + Suspense + QueryClient config.
- `src/components/layout/PageSkeleton.tsx` (novo) — fallback visual.
- `src/hooks/useDebouncedValue.ts` (novo).
- `src/pages/Customers.tsx`, `Sales.tsx`, `Inventory.tsx`, `Receivable.tsx`, `Payable.tsx`, `Conversations.tsx`, `PreSales.tsx` — aplicar debounce no state de busca (mudança de ~2 linhas cada).
- 1 migração SQL com os índices `IF NOT EXISTS` acima.

**Segurança:** nada mexe em RLS, auth, políticas, validações ou logs. Zero mudança de schema além de índices.

**Verificação:** build TypeScript + navegação nas rotas principais via preview para confirmar que nada quebrou.

---

## 5) Ganho estimado

| Área | Antes | Depois (esperado) |
|---|---|---|
| Bundle JS inicial | ~1 arquivo com 23 páginas | Dashboard + shared libs (~60–75% menor) |
| Tempo até 1ª interação (mobile) | alto | baixo |
| Refetch ao trocar de aba | sempre | só se >30s |
| Digitação em busca (300 clientes) | trava leve por tecla | fluido (debounce) |
| Escala do banco | OK hoje | OK até dezenas de milhares |

Confirma que posso seguir com essas mudanças?
