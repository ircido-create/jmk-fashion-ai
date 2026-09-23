import { describe, it, expect } from "vitest";
import { carteiraBase, dueDates, installmentAmounts, installmentsDiff, splitEvenly, type CarteiraInput } from "@/pages/pos/installments";

const base: CarteiraInput = {
  splitMode: false,
  paymentMethod: "fiado",
  generateReceivables: true,
  total: 300,
  installments: 3,
  splits: [],
  splitFiadoInstallments: 1,
};

describe("carteiraBase — o que vira conta a receber", () => {
  it("carteira: o total, na quantidade de parcelas escolhida", () => {
    expect(carteiraBase(base)).toEqual({ amount: 300, parts: 3 });
  });

  it("crédito com 'gerar contas a receber' também vai para a carteira", () => {
    expect(carteiraBase({ ...base, paymentMethod: "credito" })).toEqual({ amount: 300, parts: 3 });
  });

  it("crédito sem 'gerar contas a receber' não gera nada", () => {
    expect(carteiraBase({ ...base, paymentMethod: "credito", generateReceivables: false })).toBeNull();
  });

  it.each(["dinheiro", "pix", "debito"] as const)("%s não gera conta a receber", (m) => {
    expect(carteiraBase({ ...base, paymentMethod: m })).toBeNull();
  });

  it("pagamento misto: só a parte na carteira, nas parcelas da carteira", () => {
    const r = carteiraBase({
      ...base,
      splitMode: true,
      splits: [{ method: "pix", amount: 100 }, { method: "fiado", amount: 200 }],
      splitFiadoInstallments: 4,
    });
    expect(r).toEqual({ amount: 200, parts: 4 });
  });

  it("pagamento misto sem parte na carteira não gera nada", () => {
    expect(carteiraBase({ ...base, splitMode: true, splits: [{ method: "pix", amount: 300 }] })).toBeNull();
  });

  it("quantidade de parcelas nunca é menor que 1", () => {
    expect(carteiraBase({ ...base, installments: 0 })).toEqual({ amount: 300, parts: 1 });
  });
});

describe("splitEvenly — divisão em parcelas iguais", () => {
  it("a última absorve os centavos e a soma bate", () => {
    expect(splitEvenly(100, 3)).toEqual([33.33, 33.33, 33.34]);
  });

  it.each([[1000, 7], [89.9, 4], [0.1, 3], [1234.56, 12]])("%s em %s vezes soma exatamente", (total, n) => {
    const parts = splitEvenly(total, n);
    expect(parts).toHaveLength(n);
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(total);
  });
});

describe("installmentAmounts — valores das parcelas", () => {
  it("sem ajuste: divisão igual", () => {
    expect(installmentAmounts({ amount: 300, parts: 3 }, [], false)).toEqual([100, 100, 100]);
  });

  it("com ajuste: usa os valores digitados", () => {
    expect(installmentAmounts({ amount: 300, parts: 3 }, ["150", "100", "50"], true)).toEqual([150, 100, 50]);
  });

  it("aceita valor digitado no formato brasileiro (1.234,56)", () => {
    expect(installmentAmounts({ amount: 2469.12, parts: 2 }, ["1.234,56", "1234,56"], true)).toEqual([1234.56, 1234.56]);
  });

  it("aceita o valor que a própria tela preenche ao abrir o ajuste (33.34)", () => {
    expect(installmentAmounts({ amount: 100, parts: 3 }, ["33.33", "33.33", "33.34"], true)).toEqual([33.33, 33.33, 33.34]);
  });

  it("ajuste com quantidade diferente da escolhida é ignorado (volta à divisão igual)", () => {
    expect(installmentAmounts({ amount: 300, parts: 3 }, ["150", "150"], true)).toEqual([100, 100, 100]);
  });

  it("sem carteira, nenhuma parcela", () => {
    expect(installmentAmounts(null, ["1"], true)).toEqual([]);
  });

  it("installmentsDiff acusa quando a soma não confere", () => {
    expect(installmentsDiff({ amount: 300 }, [150, 100, 40])).toBe(10);
    expect(installmentsDiff({ amount: 100 }, [33.33, 33.33, 33.34])).toBe(0);
  });
});

describe("dueDates — vencimentos", () => {
  it("mensal: mesmo dia nos meses seguintes", () => {
    expect(dueDates("2026-09-15", 3, "mensal")).toEqual(["2026-09-15", "2026-10-15", "2026-11-15"]);
  });

  it("caso real: 30/08 em 7x — a parcela de fevereiro cai em 28/02, não em 02/03", () => {
    expect(dueDates("2026-08-30", 7, "mensal")).toEqual([
      "2026-08-30", "2026-09-30", "2026-10-30", "2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28",
    ]);
  });

  it("dia 31 em mês de 30 dias usa o dia 30 e volta ao 31 depois", () => {
    expect(dueDates("2026-08-31", 3, "mensal")).toEqual(["2026-08-31", "2026-09-30", "2026-10-31"]);
  });

  it("ano bissexto: 29/02", () => {
    expect(dueDates("2028-01-31", 2, "mensal")).toEqual(["2028-01-31", "2028-02-29"]);
  });

  it("virada de ano", () => {
    expect(dueDates("2026-11-10", 3, "mensal")).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
  });

  it("quinzenal: de 15 em 15 dias, atravessando mês", () => {
    expect(dueDates("2026-09-20", 3, "quinzenal")).toEqual(["2026-09-20", "2026-10-05", "2026-10-20"]);
  });

  it("uma parcela: só a data escolhida", () => {
    expect(dueDates("2026-09-30", 1, "mensal")).toEqual(["2026-09-30"]);
  });
});
