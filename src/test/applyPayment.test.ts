import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { applyReceivablePayment } from "@/lib/applyPayment";
import { reconcileManualPayment, type ReceivableLite } from "@/lib/reconcile";

const parcelas: ReceivableLite[] = [
  { id: "a", customer_id: "c1", customer_name: "X", amount: 100, due_date: "2026-01-10", status: "vencido" },
  { id: "b", customer_id: "c1", customer_name: "X", amount: 80, due_date: "2026-02-10", status: "pendente" },
];

describe("applyReceivablePayment", () => {
  beforeEach(() => rpc.mockReset());

  it("manda tudo numa única chamada, com o saldo que a tela viu em cada parcela", async () => {
    rpc.mockResolvedValue({ data: { proof_id: "p1", settled: 1, reduced: 1, paid_total: 130 }, error: null });
    const { actions } = reconcileManualPayment(parcelas, 130);

    const out = await applyReceivablePayment({
      actions,
      paidAtIso: "2026-09-20T15:00:00.000Z",
      proof: { storage_path: "", description: "Baixa de X", customer_id: "c1" },
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("apply_receivable_payment", {
      p_actions: [
        { receivable_id: "a", kind: "settle", amount_paid: 100, expected_amount: 100 },
        { receivable_id: "b", kind: "reduce", amount_paid: 30, expected_amount: 80 },
      ],
      p_paid_at: "2026-09-20T15:00:00.000Z",
      p_proof_id: undefined,
      p_proof: { storage_path: "", description: "Baixa de X", customer_id: "c1" },
    });
    expect(out.proof_id).toBe("p1");
  });

  it("com comprovante existente, só manda o id dele", async () => {
    rpc.mockResolvedValue({ data: { proof_id: "p9", settled: 1, reduced: 0, paid_total: 100 }, error: null });
    const { actions } = reconcileManualPayment(parcelas, 100);
    await applyReceivablePayment({ actions, paidAtIso: "2026-09-20T15:00:00.000Z", proofId: "p9" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_proof_id: "p9", p_proof: undefined });
  });

  it("erro do banco vira exceção com a mensagem dele (a tela mostra ao usuário)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "A parcela 10/01/2026 já está pago. Recarregue a tela antes de dar baixa." } });
    const { actions } = reconcileManualPayment(parcelas, 100);
    await expect(applyReceivablePayment({ actions, paidAtIso: "2026-09-20T15:00:00.000Z" })).rejects.toThrow(/já está pago/);
  });
});
