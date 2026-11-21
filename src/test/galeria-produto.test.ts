import { describe, it, expect } from "vitest";
import { galeriaDoEditor, galeriaComNovaCapa, MAX_FOTOS_DA_PECA } from "@/lib/galeriaProduto";

/**
 * Regressão: trocar a capa e depois salvar só o preço deve preservar a nova
 * capa, sem acumular uma galeria antiga que não contém mais a capa vigente.
 */
describe("galeria que abre no editor do Estoque", () => {
  it("capa trocada por fora entra na frente e não é desfeita ao salvar", () => {
    const fotos = galeriaDoEditor({ image_url: "nova.jpg", images: ["velha.jpg", "detalhe.jpg"] });
    expect(fotos).toEqual(["nova.jpg"]);
    // Ao salvar, a capa gravada é fotos[0]: continua a nova.
    expect(fotos[0]).toBe("nova.jpg");
  });

  it("capa que já está na galeria sempre vem primeiro sem duplicar detalhes", () => {
    expect(galeriaDoEditor({ image_url: "capa.jpg", images: ["capa.jpg", "detalhe.jpg"] }))
      .toEqual(["capa.jpg", "detalhe.jpg"]);
    // Salvar só o preço não pode promover a primeira foto antiga à capa.
    expect(galeriaDoEditor({ image_url: "detalhe.jpg", images: ["capa.jpg", "detalhe.jpg"] }))
      .toEqual(["detalhe.jpg", "capa.jpg"]);
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
    const cheia = [...Array.from({ length: MAX_FOTOS_DA_PECA }, (_, i) => `f${i}.jpg`), "nova.jpg"];
    const fotos = galeriaDoEditor({ image_url: "nova.jpg", images: cheia });
    expect(fotos).toHaveLength(MAX_FOTOS_DA_PECA);
    expect(fotos[0]).toBe("nova.jpg");
    expect(fotos).not.toContain(`f${MAX_FOTOS_DA_PECA - 1}.jpg`);
  });

  it("furo nulo na galeria não vira foto quebrada", () => {
    const fotos = galeriaDoEditor({ image_url: "nova.jpg", images: ["", "velha.jpg"] as string[] });
    expect(fotos).toEqual(["nova.jpg"]);
  });

  it("uma foto antiga diferente da capa não é acumulada na edição", () => {
    expect(galeriaDoEditor({ image_url: "nova.jpg", images: ["velha.jpg"] })).toEqual(["nova.jpg"]);
  });

  it("preserva detalhes quando a capa ainda está na galeria e elimina duplicadas", () => {
    expect(galeriaDoEditor({ image_url: "nova.jpg", images: ["costas.jpg", "nova.jpg", "costas.jpg", "tecido.jpg"] }))
      .toEqual(["nova.jpg", "costas.jpg", "tecido.jpg"]);
  });
});

describe("troca da capa pelo buscador", () => {
  it.each([{ images: [] }, { images: ["antiga.jpg"] }])("zero ou uma foto é substituída pela nova: $images", ({ images }) => {
    expect(galeriaComNovaCapa({ image_url: "antiga.jpg", images }, "nova.jpg")).toEqual(["nova.jpg"]);
  });

  it("nova capa vira a primeira, remove a anterior e mantém detalhes na ordem", () => {
    const images = galeriaComNovaCapa({ image_url: "antiga.jpg", images: ["costas.jpg", "antiga.jpg", "tecido.jpg"] }, "nova.jpg");
    expect(images).toEqual(["nova.jpg", "costas.jpg", "tecido.jpg"]);
    const fotosAoEditar = galeriaDoEditor({ image_url: "nova.jpg", images });
    expect(fotosAoEditar).toEqual(images);
    expect(fotosAoEditar[0]).toBe("nova.jpg");
  });

  it("nova capa já presente não é duplicada e trocar novamente é idempotente", () => {
    const produto = { image_url: "antiga.jpg", images: ["antiga.jpg", "detalhe.jpg", "nova.jpg", "detalhe.jpg"] };
    const images = galeriaComNovaCapa(produto, "nova.jpg");
    expect(images).toEqual(["nova.jpg", "detalhe.jpg"]);
    expect(galeriaComNovaCapa({ image_url: "nova.jpg", images }, "nova.jpg")).toEqual(images);
  });

  it("respeita o limite de oito fotos na troca", () => {
    const images = galeriaComNovaCapa({ image_url: "antiga.jpg", images: Array.from({ length: 8 }, (_, i) => `detalhe${i}.jpg`) }, "nova.jpg");
    expect(images).toEqual(["nova.jpg", ...Array.from({ length: 7 }, (_, i) => `detalhe${i}.jpg`)]);
  });
});
