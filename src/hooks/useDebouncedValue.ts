import { useEffect, useState } from "react";

/**
 * Retorna `value` com atraso — útil para inputs de busca.
 * Evita filtrar/consultar a cada tecla.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export default useDebouncedValue;
