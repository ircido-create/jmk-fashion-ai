import { describe, it, expect } from "vitest";
import { categoriaSugerida, categoriaDoCadastro } from "@/lib/categoriaPorNome";

describe("categoria adivinhada pelo nome da peça", () => {
  it("lê o nome como ele é cadastrado, com abreviação e ponto", () => {
    // O exemplo que motivou a mudança.
    expect(categoriaSugerida("SAIA SECR.MONT.TELMA")).toBe("saia");
    expect(categoriaSugerida("BL MODAL 2 TRANÇA")).toBe("blusa");
    expect(categoriaSugerida("TUB.BASICO M/C CAMILA")).toBe("vestido");
    expect(categoriaSugerida("VEST. MARIA AMORE 2846")).toBe("vestido");
  });

  it("não se perde com acento nem com maiúscula", () => {
    expect(categoriaSugerida("Calça Pantalona Preta")).toBe("calca");
    expect(categoriaSugerida("CALÇA ALFAIATARIA")).toBe("calca");
    expect(categoriaSugerida("blusa de tricot")).toBe("blusa");
  });

  it("peça inteira ganha da parte: conjunto de saia e blusa é conjunto", () => {
    expect(categoriaSugerida("CONJUNTO SAIA E BLUSA MARIANA")).toBe("conjunto");
    expect(categoriaSugerida("MACACÃO PANTALONA")).toBe("conjunto");
  });

  it("acessório não vai para o provador", () => {
    expect(categoriaSugerida("CACHECOL C/ DETALHE NO OMBRO CANELADO")).toBe("outro");
    expect(categoriaSugerida("BOLSA TIRACOLO")).toBe("outro");
  });

  it("usa a descrição quando o nome não diz nada", () => {
    expect(categoriaSugerida("BELLA", "Vestido midi de alça com fenda")).toBe("vestido");
  });

  it("sem pista nenhuma fica em branco, em vez de chutar", () => {
    // Chute errado manda a peça para a prateleira errada e faz o provador
    // vestir a peça no lugar errado do corpo: campo vazio é melhor.
    expect(categoriaSugerida("BELLA")).toBeNull();
    expect(categoriaSugerida("Moda Feminina")).toBeNull();
    expect(categoriaSugerida("")).toBeNull();
    expect(categoriaSugerida(null, null)).toBeNull();
  });

  it("não acha peça dentro de outra palavra", () => {
    // "SAIA" não pode sair de "ENSAIO", nem "TOP" de "TOPÁZIO".
    expect(categoriaSugerida("ENSAIO FOTOGRAFICO")).toBeNull();
    expect(categoriaSugerida("COLAR TOPAZIO")).toBe("outro");
  });
});

describe("categoria que abre no cadastro", () => {
  it("o que o operador escolheu continua valendo, mesmo contra o palpite", () => {
    expect(categoriaDoCadastro({ name: "SAIA LONGA", garment_type: "vestido" })).toBe("vestido");
  });

  it("peça sem categoria abre com o palpite do nome", () => {
    expect(categoriaDoCadastro({ name: "SAIA SECR.MONT.TELMA", garment_type: null })).toBe("saia");
  });

  it("categoria inválida vinda do banco não é aceita de olhos fechados", () => {
    expect(categoriaDoCadastro({ name: "SAIA PLISSADA", garment_type: "SAIAS" })).toBe("saia");
    expect(categoriaDoCadastro({ name: "BELLA", garment_type: "xpto" })).toBe("");
  });
});
