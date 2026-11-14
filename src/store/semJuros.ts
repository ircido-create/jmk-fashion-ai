import type { StoreSettings } from "./types";

/**
 * A frase do parcelamento, escrita do jeito que a cliente lê.
 *
 * A regra mora no painel (`store_settings`), não aqui: até quantas parcelas a
 * loja assume a taxa do cartão e a partir de que valor da compra. A vitrine e
 * o checkout leem a mesma configuração, então o que está anunciado é o que a
 * cliente encontra na hora de pagar.
 */
export const PARCELAS_SEM_JUROS_PADRAO = 1;

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function parcelasSemJuros(s: StoreSettings | null): number {
  const n = Number(s?.credito_parcelas_sem_juros);
  if (!Number.isFinite(n) || n < 1) return PARCELAS_SEM_JUROS_PADRAO;
  return Math.min(12, Math.round(n));
}

export function valorMinimoSemJuros(s: StoreSettings | null): number {
  const v = Number(s?.credito_valor_minimo);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Ex.: "Até 3x no crédito sem juros nas compras a partir de R$ 300,00, por conta da loja." */
export function fraseDoParcelamento(s: StoreSettings | null): string {
  const n = parcelasSemJuros(s);
  const minimo = valorMinimoSemJuros(s);
  if (n <= 1) {
    return "1x no crédito sem juros, por conta da loja. A partir de 2x, os juros do cartão ficam por conta do cliente.";
  }
  const ate = minimo > 0
    ? `Até ${n}x no crédito sem juros nas compras a partir de ${brl(minimo)}, por conta da loja.`
    : `Até ${n}x no crédito sem juros, por conta da loja.`;
  const depois = minimo > 0
    ? ` A partir de ${n + 1}x — ou abaixo desse valor, da 2ª parcela em diante — os juros do cartão ficam por conta do cliente.`
    : ` A partir de ${n + 1}x, os juros do cartão ficam por conta do cliente.`;
  return ate + depois;
}
