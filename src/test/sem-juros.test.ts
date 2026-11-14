import { describe, expect, it } from "vitest";

import { fraseDoParcelamento, parcelasSemJuros, valorMinimoSemJuros } from "@/store/semJuros";
import type { StoreSettings } from "@/store/types";

const conf = (p: number | null, v: number | null): StoreSettings => ({
  whatsapp: null,
  pickup_address: null,
  delivery_note: null,
  reserve_hours: null,
  credito_parcelas_sem_juros: p,
  credito_valor_minimo: v,
});

describe("crédito sem juros", () => {
  it("usa o que está no painel", () => {
    expect(parcelasSemJuros(conf(3, 300))).toBe(3);
    expect(valorMinimoSemJuros(conf(3, 300))).toBe(300);
  });

  it("sem configuração, só a à vista sai sem juros", () => {
    expect(parcelasSemJuros(null)).toBe(1);
    expect(parcelasSemJuros(conf(null, null))).toBe(1);
    expect(valorMinimoSemJuros(conf(3, null))).toBe(0);
  });

  it("nunca passa de 12 parcelas nem aceita zero", () => {
    expect(parcelasSemJuros(conf(99, 0))).toBe(12);
    expect(parcelasSemJuros(conf(0, 0))).toBe(1);
  });

  it("a frase diz as parcelas e o valor mínimo", () => {
    const frase = fraseDoParcelamento(conf(3, 300));
    expect(frase).toContain("Até 3x");
    // o separador do "R$" vem como espaço fino do Intl, não como espaço comum
    expect(frase).toMatch(/R\$\s300,00/);
    expect(frase).toContain("A partir de 4x");
  });

  it("sem valor mínimo, a frase não inventa um", () => {
    const frase = fraseDoParcelamento(conf(3, 0));
    expect(frase).toContain("Até 3x no crédito sem juros, por conta da loja.");
    expect(frase).not.toMatch(/a partir de R\$/);
  });

  it("com uma parcela, mantém a frase antiga", () => {
    expect(fraseDoParcelamento(conf(1, 300))).toContain("1x no crédito sem juros");
  });
});
