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
