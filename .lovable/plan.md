## Objetivo

Você quer garantir que, quando um cliente paga a MAIS do que a parcela atual, o excedente é usado pra abater a próxima parcela (mais antiga em aberto).

Boa notícia: a lógica em `src/lib/reconcile.ts` já faz isso. Ela soma todos os pagamentos do cliente num "pool" e vai consumindo parcelas da mais antiga pra mais nova:

- Se o pool cobre a parcela inteira → marca como **quitada** (`settle`) e continua com o que sobrou.
- Se sobra só uma parte → **reduz** o valor da próxima parcela (`reduce`) e ela continua pendente com valor menor.
- Se ainda sobrar depois de quitar tudo → vai pra lista `leftovers` (crédito sem parcela pra abater).

O que falta é **prova de que funciona** e deixar isso visível.

## Plano

1. **Adicionar teste unitário** em `src/test/reconcile.test.ts` cobrindo três casos:
   - Pagamento único = parcela → 1 `settle`.
   - Pagamento único > parcela1 mas < parcela1+parcela2 → 1 `settle` (parcela1) + 1 `reduce` (parcela2 com valor reduzido).
   - Pagamento >> soma de todas as parcelas → todas `settle` + entrada em `leftovers` com o troco.

2. **Rodar `bunx vitest run`** pra confirmar que passa.

3. **Sem mudanças na UI ou no banco.** O componente de conciliação de extrato já renderiza tanto `settle` quanto `reduce`, e o `leftovers` já aparece na seção "Sobras".

## Fora do escopo

- Não vou criar "crédito" em parcela negativa (você não pediu essa opção).
- Não vou mexer em `merge-customers`, `Receivable.tsx`, nem no fluxo de conciliação de duplicados.
