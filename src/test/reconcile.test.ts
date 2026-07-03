import { describe, it, expect } from "vitest";
import { reconcile, reconcileManualPayment, type ReceivableLite, type PaymentRow } from "@/lib/reconcile";

const mkR = (id: string, amount: number, due_date: string): ReceivableLite => ({
  id,
  customer_id: "c1",
  customer_name: "JOAO SILVA",
  customer_tax_id: "12345678900",
  amount,
  due_date,
  status: "pendente",
});

const mkP = (amount: number): PaymentRow => ({
  customer_name: "JOAO SILVA",
  tax_id: "12345678900",
  amount,
  payment_date: "2026-07-03",
});

describe("reconcile — pagamento a maior rola pra próxima parcela", () => {
  it("pagamento exato quita a parcela", () => {
    const res = reconcile([mkR("r1", 100, "2026-01-01")], [mkP(100)]);
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0]).toMatchObject({ kind: "settle", receivable_id: "r1", amount_paid: 100 });
    expect(res.leftovers).toHaveLength(0);
  });

  it("pagamento > parcela1 mas < parcela1+parcela2 → quita a 1 e reduz a 2", () => {
    const res = reconcile(
      [mkR("r1", 100, "2026-01-01"), mkR("r2", 200, "2026-02-01")],
      [mkP(150)]
    );
    expect(res.actions).toHaveLength(2);
    expect(res.actions[0]).toMatchObject({ kind: "settle", receivable_id: "r1", amount_paid: 100 });
    expect(res.actions[1]).toMatchObject({
      kind: "reduce",
      receivable_id: "r2",
      amount_paid: 50,
      new_amount: 150,
    });
    expect(res.leftovers).toHaveLength(0);
  });

  it("pagamento maior que soma total → quita tudo e gera sobra (leftover)", () => {
    const res = reconcile(
      [mkR("r1", 100, "2026-01-01"), mkR("r2", 200, "2026-02-01")],
      [mkP(500)]
    );
    expect(res.actions).toHaveLength(2);
    expect(res.actions.every((a) => a.kind === "settle")).toBe(true);
    expect(res.leftovers).toHaveLength(1);
    expect(res.leftovers[0].amount).toBeCloseTo(200, 2);
  });

  it("dois pagamentos do mesmo cliente somam e abatem em cascata", () => {
    const res = reconcile(
      [mkR("r1", 100, "2026-01-01"), mkR("r2", 100, "2026-02-01"), mkR("r3", 100, "2026-03-01")],
      [mkP(80), mkP(150)]
    );
    // pool = 230 → quita r1 (100), quita r2 (100), reduz r3 em 30 (novo=70)
    expect(res.actions).toHaveLength(3);
    expect(res.actions[0]).toMatchObject({ kind: "settle", receivable_id: "r1" });
    expect(res.actions[1]).toMatchObject({ kind: "settle", receivable_id: "r2" });
    expect(res.actions[2]).toMatchObject({ kind: "reduce", receivable_id: "r3", new_amount: 70 });
  });

  it("baixa manual com valor a maior quita selecionada e reduz a próxima", () => {
    const res = reconcileManualPayment(
      [mkR("r1", 100, "2026-01-01"), mkR("r2", 200, "2026-02-01")],
      150,
      ["r1"]
    );
    expect(res.actions).toHaveLength(2);
    expect(res.actions[0]).toMatchObject({ kind: "settle", receivable_id: "r1", amount_paid: 100 });
    expect(res.actions[1]).toMatchObject({
      kind: "reduce",
      receivable_id: "r2",
      amount_paid: 50,
      new_amount: 150,
    });
    expect(res.leftovers).toHaveLength(0);
  });
});
