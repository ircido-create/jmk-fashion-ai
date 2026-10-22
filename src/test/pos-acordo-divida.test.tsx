import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mesma fachada de Supabase dos outros testes do PDV: qualquer encadeamento
// resolve para um resultado fixo por tabela.
const tabelas: Record<string, { data: unknown; error: null }> = {};
const rpc = vi.fn();
const chain = (table: string) => {
  const result = () => tabelas[table] ?? { data: [], error: null };
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "or", "in", "insert"]) b[m] = () => b;
  b.maybeSingle = async () => {
    const r = result();
    return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
  };
  b.single = b.maybeSingle;
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
  return b;
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => chain(t), rpc: (...a: unknown[]) => rpc(...a) },
}));
// A cliente deve R$ 450,00 antes desta compra.
vi.mock("@/hooks/useCustomerDebt", () => ({ useCustomerDebt: () => ({ debt: 450, loading: false }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import POS from "@/pages/POS";
import type { SaleDraft } from "@/pages/pos/saleDraft";

const maria = { id: "c1", name: "MARIA DA SILVA", nickname: null, phone: "5511900000000" };

const rascunho = (over: Partial<SaleDraft> = {}): SaleDraft => ({
  savedAt: "2026-10-22T12:00:00.000Z",
  step: 3,
  cart: [{
    productId: "prod1", variantId: null, productName: "Vestido Teste", variantLabel: "", sku: null,
    quantity: 1, unitPrice: 300, unitCost: 100, maxQty: 9999,
  }],
  discountValue: "",
  discountType: "valor",
  customerId: "c1",
  selectedCustomer: maria,
  paymentMethod: "fiado",
  installments: 3,
  generateReceivables: true,
  cashReceived: "",
  notes: "",
  firstDueDate: "2026-11-10",
  paymentFrequency: "mensal",
  manualInstallments: [],
  isAdjustingInstallments: false,
  splitMode: false,
  splits: [],
  splitMethod: "dinheiro",
  splitAmount: "",
  splitFiadoInstallments: 1,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "abcd1234-0000-0000-0000-000000000000", error: null });
  tabelas.products = { data: [], error: null };
  tabelas.customers = { data: [maria], error: null };
  tabelas.product_variants = { data: [], error: null };
});

async function abrirPerguntaDaDivida(d: SaleDraft = rascunho()) {
  localStorage.setItem("pos_sale_draft_v1", JSON.stringify(d));
  render(<POS />);
  fireEvent.click(await screen.findByRole("button", { name: "Retomar venda" }));
  fireEvent.click(await screen.findByRole("button", { name: /Finalizar venda/ }));
  return screen.findByText("Cliente tem dívida em aberto");
}

describe("PDV — acordo com a dívida antiga", () => {
  it("pergunta antes de fechar a venda e não grava nada enquanto não decide", async () => {
    await abrirPerguntaDaDivida();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("somando: parcela dívida + compra e usa a função que encerra as antigas", async () => {
    await abrirPerguntaDaDivida();
    fireEvent.click(await screen.findByRole("button", { name: /Somar e refazer parcelas/ }));

    // Volta para a tela para conferência — ainda não gravou.
    await waitFor(() => expect(screen.queryByText("Cliente tem dívida em aberto")).toBeNull());
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /Finalizar venda/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());

    const [nome, args] = rpc.mock.calls[0] as [string, {
      p_total: number;
      p_receivables: { amount: number; description: string }[];
      p_notes: string | null;
    }];
    expect(nome).toBe("create_sale_renegociando");
    // A venda continua valendo o que foi vendido...
    expect(args.p_total).toBe(300);
    // ...e o parcelamento cobre dívida + compra: 750 em 3x.
    expect(args.p_receivables.map((r) => r.amount)).toEqual([250, 250, 250]);
    expect(args.p_receivables[0].description).toContain("acordo com dívida anterior");
    expect(args.p_notes).toContain("Acordo");
  });

  it("mantendo separado: parcela só a compra, pela função de sempre", async () => {
    await abrirPerguntaDaDivida();
    fireEvent.click(await screen.findByRole("button", { name: /Manter separado/ }));
    await waitFor(() => expect(screen.queryByText("Cliente tem dívida em aberto")).toBeNull());

    fireEvent.click(await screen.findByRole("button", { name: /Finalizar venda/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());

    const [nome, args] = rpc.mock.calls[0] as [string, { p_receivables: { amount: number }[] }];
    expect(nome).toBe("create_sale");
    expect(args.p_receivables.map((r) => r.amount)).toEqual([100, 100, 100]);
  });

  it("vencimento que não existe no mês para a venda antes de tudo", async () => {
    localStorage.setItem("pos_sale_draft_v1", JSON.stringify(rascunho({ firstDueDate: "2026-11-31" })));
    render(<POS />);
    fireEvent.click(await screen.findByRole("button", { name: "Retomar venda" }));
    fireEvent.click(await screen.findByRole("button", { name: /Finalizar venda/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String((toast.error as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]))
      .toContain("Vencimento da 1ª parcela inválido");
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByText("Cliente tem dívida em aberto")).toBeNull();
  });
});
