import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { findKey, parseAmount, parseDate, readFirstSheet } from "@/lib/spreadsheet";

const xlsxFile = (linhas: unknown[][], formatar?: (ws: XLSX.WorkSheet) => void) => {
  const ws = XLSX.utils.aoa_to_sheet(linhas, { cellDates: true });
  formatar?.(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plan1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "planilha.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};

describe("readFirstSheet — planilha de verdade", () => {
  it("Excel: data 10/08/2026 continua 10/08 (antes virava 08/09)", async () => {
    const [row] = await readFirstSheet(xlsxFile([["Vencimento"], [new Date(2026, 7, 10)]]));
    expect(parseDate(row.Vencimento)).toBe("2026-08-10");
  });

  it("Excel: valor 1.234,56 formatado continua 1234.56 (antes virava zero e a linha sumia)", async () => {
    const [row] = await readFirstSheet(xlsxFile([["Valor"], [1234.56]], (ws) => { ws["A2"].z = "#,##0.00"; }));
    expect(parseAmount(row.Valor)).toBe(1234.56);
  });

  it("CSV: 10/08/2026 é lido como dia 10 de agosto (antes virava 10/07)", async () => {
    const f = new File(["Cliente,Valor,Vencimento\nA,\"1.234,56\",10/08/2026\nB,50,05/09/2026\n"], "x.csv", { type: "text/csv" });
    const rows = await readFirstSheet(f);
    expect(rows.map((r) => parseDate(r.Vencimento))).toEqual(["2026-08-10", "2026-09-05"]);
    expect(parseAmount(rows[0].Valor)).toBe(1234.56);
  });

  it("CSV: CPF com zero à esquerda não perde o zero", async () => {
    const f = new File(["Cliente,CPF\nA,01234567890\n"], "x.csv", { type: "text/csv" });
    const [row] = await readFirstSheet(f);
    expect(String(row.CPF)).toBe("01234567890");
  });
});

describe("parseAmount — valor da planilha", () => {
  it.each([
    ["R$ 1.234,56", 1234.56],
    ["1.234,56", 1234.56],
    ["1234,56", 1234.56],
    ["89,90", 89.9],
    ["R$ 100", 100],
    ["1.000.000,00", 1000000],
    ["", 0],
    ["abc", 0],
  ])("%s → %s", (entrada, esperado) => {
    expect(parseAmount(entrada)).toBe(esperado);
  });

  it("número vem como está", () => {
    expect(parseAmount(57.19)).toBe(57.19);
  });
});

describe("parseDate — vencimento/pagamento", () => {
  it.each([
    ["05/09/2026", "2026-09-05"],
    ["5/9/2026", "2026-09-05"],
    ["05-09-26", "2026-09-05"],
    ["2026-09-05", "2026-09-05"],
    ["2026-09-05T10:00:00", "2026-09-05"],
    ["", ""],
    ["não é data", ""],
  ])("%s → %s", (entrada, esperado) => {
    expect(parseDate(entrada)).toBe(esperado);
  });

  it("dia vem antes do mês (padrão brasileiro)", () => {
    expect(parseDate("01/02/2026")).toBe("2026-02-01");
  });

  it("Date vira AAAA-MM-DD", () => {
    expect(parseDate(new Date("2026-09-05T12:00:00Z"))).toBe("2026-09-05");
  });
});

describe("findKey — acha a coluna", () => {
  const row = { "Razão Social": "X", "Valor (R$)": "10", "CPF/CNPJ": "1", "Data Crédito": "1/1/26" };

  it("ignora acento e maiúsculas", () => {
    expect(findKey(row, ["razao social"])).toBe("Razão Social");
  });

  it("aceita coluna que contém o nome", () => {
    expect(findKey(row, ["valor"])).toBe("Valor (R$)");
    expect(findKey(row, ["data"])).toBe("Data Crédito");
  });

  it("respeita a ordem dos candidatos", () => {
    expect(findKey(row, ["cpf/cnpj", "cpf"])).toBe("CPF/CNPJ");
  });

  it("null quando não há coluna", () => {
    expect(findKey(row, ["vencimento"])).toBeNull();
  });
});
