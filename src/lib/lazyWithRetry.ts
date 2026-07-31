import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "chunk-reload-ts";

/**
 * Lazy import resiliente: quando um deploy novo invalida os chunks antigos,
 * o import dinâmico falha. Nesse caso recarregamos a página uma única vez
 * para buscar o manifest atualizado.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const mod = await factory();
      sessionStorage.removeItem(RELOAD_KEY);
      return mod;
    } catch (err) {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      // evita loop de reload: só recarrega se não recarregou nos últimos 10s
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
        // trava até o reload acontecer
        return await new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
