import { describe, it, expect } from "vitest";
import { calculateTrust, type ReceivableLike } from "@/lib/trustScore";

const ontem = () => {
  const d = new Date();
  d.setDate(d.getDate() - 13);
  return d.toISOString().slice(0, 10);
};
const daqui = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};

const parcela = (over: Partial<ReceivableLike>): ReceivableLike => ({
  id: Math.random().toString(36),
  amount: 220,
  due_date: daqui(18),
  status: "pendente",
  paid_at: null,
  ...over,
});

describe("Nota de confiança do cliente", () => {
  it("parcela cancelada não vira dívida vencida", () => {
    // Caso CIDA ARLETE (02/11/2026): devolveu uma peça, a parcela velha foi
    // cancelada e o saldo entrou num acordo novo. A tela mostrava os R$ 176
    // cancelados como "valor em aberto vencido" — dinheiro cobrado duas vezes.
    const r = calculateTrust([
      parcela({ status: "cancelado", amount: 176, due_date: ontem() }),
      parcela({ amount: 220, due_date: daqui(18) }),
      parcela({ amount: 220, due_date: daqui(48) }),
      parcela({ amount: 220, due_date: daqui(79) }),
      parcela({ amount: 220, due_date: daqui(110) }),
    ]);

    expect(r.totalOverdueAmount).toBe(0);
    expect(r.openOverdue).toBe(0);
    expect(r.openPending).toBe(4);
    expect(r.totalCount).toBe(4);
  });

  it("parcela cancelada também não entra como pagamento no histórico", () => {
    const r = calculateTrust([
      parcela({ status: "cancelado", amount: 500, due_date: ontem(), paid_at: ontem() }),
    ]);

    expect(r.paidOnTime).toBe(0);
    expect(r.paidLate).toBe(0);
    expect(r.totalCount).toBe(0);
  });

  it("vencida de verdade continua contando", () => {
    const r = calculateTrust([
      parcela({ amount: 190, due_date: ontem() }),
      parcela({ amount: 220, due_date: daqui(18) }),
    ]);

    expect(r.totalOverdueAmount).toBe(190);
    expect(r.openOverdue).toBe(1);
    expect(r.openPending).toBe(1);
  });

  it("quem paga em dia mantém a nota alta", () => {
    const r = calculateTrust([
      parcela({ status: "pago", amount: 220, due_date: daqui(-30), paid_at: daqui(-31) }),
      parcela({ status: "pago", amount: 220, due_date: daqui(-60), paid_at: daqui(-62) }),
    ]);

    expect(r.paidOnTime).toBe(2);
    expect(r.score).toBeGreaterThanOrEqual(90);
  });
});

describe("Data da parcela na tela", () => {
  it("data pura não volta um dia por causa do fuso", async () => {
    const { fmtDate } = await import("@/lib/utils");
    // Caso CIDA ARLETE: parcela de 20/11/2026 aparecia como 19/11.
    expect(fmtDate("2026-11-20")).toBe("20/11/2026");
    expect(fmtDate("2027-01-20")).toBe("20/01/2027");
    expect(fmtDate("2026-01-01")).toBe("01/01/2026");
  });

  it("data com hora continua sendo respeitada", async () => {
    const { fmtDate } = await import("@/lib/utils");
    expect(fmtDate("2026-11-20T15:30:00-03:00")).toBe("20/11/2026");
  });

  it("sem data, mostra um traço", async () => {
    const { fmtDate } = await import("@/lib/utils");
    expect(fmtDate(null)).toBe("—");
  });
});
