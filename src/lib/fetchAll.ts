import { supabase } from "@/integrations/supabase/client";

/**
 * Busca todas as linhas de uma tabela contornando o limite padrão de 1000 do Supabase
 * paginando via .range(). Aceita um builder de query para permitir filtros/ordenação.
 *
 * Exemplo:
 *   const rows = await fetchAll((q) => q.from("customers").select("*").order("name"));
 */
export async function fetchAll<T = any>(
  build: (sb: typeof supabase) => any,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const q = build(supabase).range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Busca linhas filtrando por uma lista de ids, em lotes. Uma lista grande num só
 * `.in()` vira um endereço enorme que o servidor recusa (400 acima de ~700 ids) —
 * e quem ignorava o erro via a lista vazia (foi assim que parcelas pagas
 * pareceram sem pagamento em Contas a Receber). Erro de qualquer lote é lançado.
 */
export async function fetchByIds<T = any>(
  ids: string[],
  build: (sb: typeof supabase, chunk: string[]) => any,
  chunkSize = 200
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    all.push(...(await fetchAll<T>((sb) => build(sb, chunk))));
  }
  return all;
}
