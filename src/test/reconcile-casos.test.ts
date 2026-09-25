import { describe, it, expect } from "vitest";
import { reconcile, reconcileManualPayment, type ReceivableLite, type PaymentRow } from "@/lib/reconcile";

const rec = (over: Partial<ReceivableLite> & { id: string; amount: number; due_date: string }): ReceivableLite => ({
  customer_id: "c1",
  customer_name: "MARIA DA SILVA",
  customer_tax_id: null,
  status: "pendente",
  ...over,
});

const pay = (over: Partial<PaymentRow> & { amount: number }): PaymentRow => ({
  customer_name: "MARIA DA SILVA",
  tax_id: "",
  payment_date: "2026-09-20",
  ...over,
});

const soma = (ns: number[]) => Math.round(ns.reduce((s, n) => s + n, 0) * 100) / 100;

describe("reconcileManualPayment — baixa manual", () => {
  it("quita sempre a parcela mais antiga, mesmo que a tela tenha marcado outra", () => {
    const res = reconcileManualPayment(
      [rec({ id: "mar", amount: 100, due_date: "2026-03-10" }), rec({ id: "jan", amount: 100, due_date: "2026-01-10" })],
      100,
    );
    expect(res.actions).toEqual([expect.objectContaining({ kind: "settle", receivable_id: "jan", amount_paid: 100 })]);
  });

  it("soma parcelas de vendas diferentes pela data de vencimento (caso CONSTANCIA: PIX de 210)", () => {
    const res = reconcileManualPayment(
      [
        rec({ id: "venda2-1", amount: 110, due_date: "2026-10-05" }),
        rec({ id: "venda1-2", amount: 110, due_date: "2026-09-25" }),
        rec({ id: "venda1-3", amount: 110, due_date: "2026-10-25" }),
      ],
      210,
    );
    expect(res.actions).toEqual([
      expect.objectContaining({ kind: "settle", receivable_id: "venda1-2", amount_paid: 110 }),
      expect.objectContaining({ kind: "reduce", receivable_id: "venda2-1", amount_paid: 100, new_amount: 10 }),
    ]);
    expect(res.leftovers).toHaveLength(0);
  });

  it("ignora parcelas pagas e canceladas", () => {
    const res = reconcileManualPayment(
      [
        rec({ id: "paga", amount: 100, due_date: "2026-01-10", status: "pago" }),
        rec({ id: "cancelada", amount: 100, due_date: "2026-02-10", status: "cancelado" }),
        rec({ id: "aberta", amount: 100, due_date: "2026-03-10", status: "vencido" }),
      ],
      100
    );
    expect(res.actions.map((a) => a.receivable_id)).toEqual(["aberta"]);
  });

  it("valor menor que a parcela reduz o saldo e não quita", () => {
    const res = reconcileManualPayment([rec({ id: "r", amount: 150, due_date: "2026-01-10" })], 40);
    expect(res.actions).toEqual([
      expect.objectContaining({ kind: "reduce", receivable_id: "r", amount_paid: 40, new_amount: 110, original_amount: 150 }),
    ]);
    expect(res.leftovers).toHaveLength(0);
  });

  it("centavos não somem nem aparecem por arredondamento", () => {
    const parcelas = [
      rec({ id: "a", amount: 33.33, due_date: "2026-01-10" }),
      rec({ id: "b", amount: 33.33, due_date: "2026-02-10" }),
      rec({ id: "c", amount: 33.34, due_date: "2026-03-10" }),
    ];
    const res = reconcileManualPayment(parcelas, 100);
    expect(res.actions.every((a) => a.kind === "settle")).toBe(true);
    expect(res.totals.paidSum).toBe(100);
    expect(res.leftovers).toHaveLength(0);
  });

  it("0,1 + 0,2 fecha a parcela de 0,30 (sem erro de ponto flutuante)", () => {
    const res = reconcileManualPayment([rec({ id: "r", amount: 0.3, due_date: "2026-01-10" })], 0.1 + 0.2);
    expect(res.actions[0]).toMatchObject({ kind: "settle", amount_paid: 0.3 });
    expect(res.leftovers).toHaveLength(0);
  });

  it("sobra quando não há mais parcelas, com o valor exato", () => {
    const res = reconcileManualPayment([rec({ id: "r", amount: 89.9, due_date: "2026-01-10" })], 100);
    expect(res.leftovers).toHaveLength(1);
    expect(res.leftovers[0].amount).toBe(10.1);
  });

  it("o que é abatido + a sobra é sempre igual ao valor recebido", () => {
    const parcelas = [
      rec({ id: "a", amount: 57.19, due_date: "2026-01-10" }),
      rec({ id: "b", amount: 120.5, due_date: "2026-02-10" }),
      rec({ id: "c", amount: 75.25, due_date: "2026-03-10" }),
    ];
    for (const valor of [0.01, 57.19, 57.2, 100, 177.69, 252.94, 300]) {
      const res = reconcileManualPayment(parcelas, valor);
      const sobra = res.leftovers[0]?.amount ?? 0;
      expect(soma([res.totals.paidSum, sobra])).toBe(valor);
      // nenhuma parcela recebe mais do que devia
      for (const a of res.actions) expect(a.amount_paid).toBeLessThanOrEqual(a.original_amount);
    }
  });

  it("original_amount é o saldo que a tela viu (a baixa no banco confere contra ele)", () => {
    const res = reconcileManualPayment([rec({ id: "r", amount: 80, due_date: "2026-01-10" })], 80);
    expect(res.actions[0].original_amount).toBe(80);
  });
});

describe("reconcile — conciliação do extrato", () => {
  it("casa pelo CPF mesmo com o nome escrito diferente", () => {
    const res = reconcile(
      [rec({ id: "r", amount: 100, due_date: "2026-01-10", customer_tax_id: "123.456.789-00" })],
      [pay({ amount: 100, customer_name: "Mariazinha", tax_id: "12345678900" })],
    );
    expect(res.actions).toEqual([expect.objectContaining({ kind: "settle", receivable_id: "r" })]);
    expect(res.unmatchedPayments).toHaveLength(0);
  });

  it("casa pelo nome ignorando acento e maiúsculas", () => {
    const res = reconcile(
      [rec({ id: "r", amount: 100, due_date: "2026-01-10", customer_name: "JOSÉ ANTÔNIO" })],
      [pay({ amount: 100, customer_name: "jose antonio" })],
    );
    expect(res.actions).toHaveLength(1);
  });

  it("casa pelo apelido", () => {
    const res = reconcile(
      [rec({ id: "r", amount: 100, due_date: "2026-01-10", customer_nickname: "Nena" })],
      [pay({ amount: 100, customer_name: "NENA" })],
    );
    expect(res.actions).toHaveLength(1);
  });

  it("pagamento de quem não tem parcela em aberto vai para 'sem cliente'", () => {
    const res = reconcile(
      [rec({ id: "r", amount: 100, due_date: "2026-01-10" })],
      [pay({ amount: 50, customer_name: "OUTRA PESSOA" })],
    );
    expect(res.actions).toHaveLength(0);
    expect(res.unmatchedPayments).toHaveLength(1);
  });

  it("cada cliente só abate as próprias parcelas", () => {
    const res = reconcile(
      [
        rec({ id: "maria", amount: 100, due_date: "2026-01-10", customer_id: "c1", customer_name: "MARIA DA SILVA" }),
        rec({ id: "ana", amount: 100, due_date: "2026-01-05", customer_id: "c2", customer_name: "ANA SOUZA" }),
      ],
      [pay({ amount: 100, customer_name: "ANA SOUZA" })],
    );
    expect(res.actions.map((a) => a.receivable_id)).toEqual(["ana"]);
  });

  it("duas clientes com o MESMO nome: não adivinha — vai para 'sem cliente'", () => {
    const res = reconcile(
      [
        rec({ id: "maria1", amount: 100, due_date: "2026-01-10", customer_id: "c1" }),
        rec({ id: "maria2", amount: 100, due_date: "2026-01-10", customer_id: "c2" }),
      ],
      [pay({ amount: 100 })],
    );
    expect(res.actions).toHaveLength(0);
    expect(res.unmatchedPayments).toHaveLength(1);
    expect(res.unmatchedPayments[0].reason).toMatch(/mais de uma cliente/i);
  });

  it("mesmo nome, mas o CPF do extrato decide", () => {
    const res = reconcile(
      [
        rec({ id: "maria1", amount: 100, due_date: "2026-01-10", customer_id: "c1", customer_tax_id: "11111111111" }),
        rec({ id: "maria2", amount: 100, due_date: "2026-01-10", customer_id: "c2", customer_tax_id: "22222222222" }),
      ],
      [pay({ amount: 100, tax_id: "222.222.222-22" })],
    );
    expect(res.actions.map((a) => a.receivable_id)).toEqual(["maria2"]);
  });

  it("valores zerados ou negativos no extrato são ignorados", () => {
    const res = reconcile([rec({ id: "r", amount: 100, due_date: "2026-01-10" })], [pay({ amount: 0 }), pay({ amount: -30 })]);
    expect(res.actions).toHaveLength(0);
    expect(res.unmatchedPayments).toHaveLength(0);
  });

  it("nenhuma parcela aparece duas vezes (a baixa no banco recusa duplicadas)", () => {
    const parcelas = [
      rec({ id: "a", amount: 50, due_date: "2026-01-10" }),
      rec({ id: "b", amount: 50, due_date: "2026-02-10" }),
    ];
    const res = reconcile(parcelas, [pay({ amount: 30 }), pay({ amount: 30 }), pay({ amount: 30 })]);
    const ids = res.actions.map((a) => a.receivable_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(res.totals.paidSum).toBe(90);
  });
});
