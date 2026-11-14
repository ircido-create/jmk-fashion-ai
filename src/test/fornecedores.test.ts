import { describe, it, expect } from "vitest";
import { chaveDoFornecedor, mesmoFornecedor, fornecedorJaCadastrado } from "@/lib/fornecedores";

describe("nome de fornecedor", () => {
  it("o mesmo nome escrito de outro jeito é o mesmo fornecedor", () => {
    // Os casos reais do estoque em 14/11/2026.
    expect(mesmoFornecedor("TATA MARTELLO", "Tatá Martello")).toBe(true);
    expect(mesmoFornecedor("TATA MARTELLO", "TATAMARTELLO")).toBe(true);
    expect(mesmoFornecedor("Hapuk", "HAPUK")).toBe(true);
    expect(mesmoFornecedor("Maria Amore", "MARIA AMORE")).toBe(true);
    expect(mesmoFornecedor("Joyaly", "JOYALY")).toBe(true);
    expect(mesmoFornecedor("  Kauly  ", "Kauly")).toBe(true);
  });

  it("fornecedores diferentes continuam diferentes", () => {
    // Juntar dois fornecedores de verdade é pior que deixar dois na lista.
    expect(mesmoFornecedor("HELP CHIC", "HELP CHIK")).toBe(false);
    expect(mesmoFornecedor("Joyale", "Joyaly")).toBe(false);
    expect(mesmoFornecedor("Hapuk", "Hapuk - Store")).toBe(false);
    expect(mesmoFornecedor("Boutique k", "Boutique K Moda Feminina")).toBe(false);
    expect(mesmoFornecedor("Kamba das Malhas", "Rainha das Malhas")).toBe(false);
  });

  it("vazio não casa com nada, nem com outro vazio", () => {
    expect(mesmoFornecedor("", "")).toBe(false);
    expect(mesmoFornecedor(null, undefined)).toBe(false);
    expect(mesmoFornecedor("   ", "Kauly")).toBe(false);
    expect(chaveDoFornecedor(null)).toBe("");
  });

  it("avisa quando o que está sendo digitado já existe com outra grafia", () => {
    const cadastrados = ["TATA MARTELLO", "LINDA LI", "Hapuk"];
    expect(fornecedorJaCadastrado("tatá martello", cadastrados)).toBe("TATA MARTELLO");
    expect(fornecedorJaCadastrado("HAPUK", cadastrados)).toBe("Hapuk");
  });

  it("não avisa quando já está escrito igual, nem no começo da digitação", () => {
    const cadastrados = ["TATA MARTELLO", "Hapuk"];
    expect(fornecedorJaCadastrado("TATA MARTELLO", cadastrados)).toBeNull();
    expect(fornecedorJaCadastrado("T", cadastrados)).toBeNull();
    expect(fornecedorJaCadastrado("", cadastrados)).toBeNull();
    expect(fornecedorJaCadastrado("Fornecedor Novo", cadastrados)).toBeNull();
  });
});
