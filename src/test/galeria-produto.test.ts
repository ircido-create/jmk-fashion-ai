import { describe, it, expect } from "vitest";
import { galeriaDoEditor, MAX_FOTOS_DA_PECA } from "@/lib/galeriaProduto";

/**
 * O furo: o buscador de foto do fornecedor grava só a capa (image_url). Se o
 * editor abrisse a galeria sozinha, salvar qualquer campo regravava
 * image_url = images[0] e a foto nova sumia — voltava a antiga no Estoque, no
 * PDV, no cupom e na loja.
 */
describe("galeria que abre no editor do Estoque", () => {
  it("capa trocada por fora entra na frente e não é desfeita ao salvar", () => {
    const fotos = galeriaDoEditor({ image_url: "nova.jpg", images: ["velha.jpg", "detalhe.jpg"] });
    expect(fotos).toEqual(["nova.jpg", "velha.jpg", "detalhe.jpg"]);
    // Ao salvar, a capa gravada é fotos[0]: continua a nova.
    expect(fotos[0]).toBe("nova.jpg");
  });

  it("capa que já está na galeria não é duplicada nem reordenada", () => {
    expect(galeriaDoEditor({ image_url: "capa.jpg", images: ["capa.jpg", "detalhe.jpg"] }))
      .toEqual(["capa.jpg", "detalhe.jpg"]);
    // Mesmo quando a capa está no meio: a ordem escolhida pelo operador vale.
    expect(galeriaDoEditor({ image_url: "detalhe.jpg", images: ["capa.jpg", "detalhe.jpg"] }))
      .toEqual(["capa.jpg", "detalhe.jpg"]);
  });

  it("peça antiga, só com capa, abre com ela", () => {
    expect(galeriaDoEditor({ image_url: "capa.jpg", images: [] })).toEqual(["capa.jpg"]);
    expect(galeriaDoEditor({ image_url: "capa.jpg", images: null })).toEqual(["capa.jpg"]);
    expect(galeriaDoEditor({ image_url: "capa.jpg" })).toEqual(["capa.jpg"]);
  });

  it("peça sem foto nenhuma abre vazia", () => {
    expect(galeriaDoEditor({ image_url: null, images: null })).toEqual([]);
    expect(galeriaDoEditor({ image_url: "", images: [] })).toEqual([]);
  });

  it("galeria cheia: a capa entra e o limite da tela é respeitado", () => {
    const cheia = Array.from({ length: MAX_FOTOS_DA_PECA }, (_, i) => `f${i}.jpg`);
    const fotos = galeriaDoEditor({ image_url: "nova.jpg", images: cheia });
    expect(fotos).toHaveLength(MAX_FOTOS_DA_PECA);
    expect(fotos[0]).toBe("nova.jpg");
    expect(fotos).not.toContain(`f${MAX_FOTOS_DA_PECA - 1}.jpg`);
  });

  it("furo nulo na galeria não vira foto quebrada", () => {
    const fotos = galeriaDoEditor({ image_url: "nova.jpg", images: ["", "velha.jpg"] as string[] });
    expect(fotos).toEqual(["nova.jpg", "velha.jpg"]);
  });
});
