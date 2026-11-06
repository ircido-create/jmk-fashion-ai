import { describe, it, expect } from "vitest";
import { offerOf } from "@/store/types";

/**
 * "De R$ ... por R$ ..." na vitrine.
 *
 * O preço cobrado é sempre o price do cadastro; o "de" é só comunicação. Por
 * isso o que se testa aqui é quando ele PODE aparecer: anunciar desconto que
 * não existe é propaganda enganosa, e o número precisa bater com o que a
 * cliente vê na etiqueta.
 */
describe("Preço de oferta da loja", () => {
  it("mostra a oferta e o percentual quando o 'de' é maior", () => {
    expect(offerOf({ price: 196, compare_at_price: 280 })).toEqual({ de: 280, off: 30 });
  });

  it("peça sem oferta não anuncia nada", () => {
    expect(offerOf({ price: 280, compare_at_price: null })).toBeNull();
  });

  it("'de' igual ao preço não é oferta", () => {
    expect(offerOf({ price: 280, compare_at_price: 280 })).toBeNull();
  });

  it("'de' menor que o preço nunca vira desconto negativo", () => {
    expect(offerOf({ price: 280, compare_at_price: 200 })).toBeNull();
  });

  it("zero é ausência de oferta, não desconto de 100%", () => {
    expect(offerOf({ price: 280, compare_at_price: 0 })).toBeNull();
  });

  it("percentual é arredondado para o inteiro mais próximo", () => {
    // 150 → 99,90 é 33,4%: a vitrine mostra -33%, não -33,4%.
    expect(offerOf({ price: 99.9, compare_at_price: 150 })).toEqual({ de: 150, off: 33 });
  });
});
