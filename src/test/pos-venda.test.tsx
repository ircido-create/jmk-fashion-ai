import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Supabase falso: cada tabela devolve um resultado fixo; qualquer encadeamento
// (select/eq/order/limit/or/in/insert/maybeSingle/single) resolve para ele.
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
vi.mock("@/hooks/useCustomerDebt", () => ({ useCustomerDebt: () => ({ debt: 0, loading: false }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import POS from "@/pages/POS";
import type { SaleDraft } from "@/pages/pos/saleDraft";

const maria = { id: "c1", name: "MARIA DA SILVA", nickname: null, phone: "5511900000000" };
const vestido = {
  productId: "prod1", variantId: null, productName: "Vestido Teste", variantLabel: "", sku: null,
  quantity: 1, unitPrice: 700, unitCost: 300, maxQty: 9999,
};

const rascunho = (over: Partial<SaleDraft>): SaleDraft => ({
  savedAt: "2026-09-23T12:00:00.000Z",
  step: 3,
  cart: [vestido],
  discountValue: "",
  discountType: "valor",
  customerId: "c1",
  selectedCustomer: maria,
  paymentMethod: "fiado",
  installments: 7,
  generateReceivables: true,
  cashReceived: "",
  notes: "",
  firstDueDate: "2026-08-30",
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

async function retomarEFinalizar(d: SaleDraft) {
  localStorage.setItem("pos_sale_draft_v1", JSON.stringify(d));
  render(<POS />);
  fireEvent.click(await screen.findByRole("button", { name: "Retomar venda" }));
  fireEvent.click(await screen.findByRole("button", { name: /Finalizar venda/ }));
  await waitFor(() => expect(rpc).toHaveBeenCalled());
  const [nome, args] = rpc.mock.calls[0];
  expect(nome).toBe("create_sale");
  return args as { p_total: number; p_installments: number; p_payment_method: string; p_receivables: { amount: number; due_date: string; description: string }[] };
}

describe("PDV — venda na carteira até o banco", () => {
  it("7x a partir de 30/08: parcelas iguais que somam o total e fevereiro em 28/02", async () => {
    const args = await retomarEFinalizar(rascunho({}));
    expect(args.p_total).toBe(700);
    expect(args.p_payment_method).toBe("fiado");
    expect(args.p_installments).toBe(7);
    expect(args.p_receivables.map((r) => r.due_date)).toEqual([
      "2026-08-30", "2026-09-30", "2026-10-30", "2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28",
    ]);
    expect(args.p_receivables.map((r) => r.amount)).toEqual([100, 100, 100, 100, 100, 100, 100]);
    expect(args.p_receivables[0].description).toBe("Carteira (1/7) — 1 item(ns)");
    // cupom aberto com o número da venda
    expect((await screen.findAllByText(/ABCD1234/)).length).toBeGreaterThan(0);
  });

  it("valores ajustados à mão vão como digitados", async () => {
    const args = await retomarEFinalizar(rascunho({
      installments: 3, firstDueDate: "2026-10-10",
      isAdjustingInstallments: true, manualInstallments: ["300", "200", "200"],
    }));
    expect(args.p_receivables.map((r) => [r.due_date, r.amount])).toEqual([
      ["2026-10-10", 300], ["2026-11-10", 200], ["2026-12-10", 200],
    ]);
  });

  it("ajuste que não fecha o total bloqueia a venda (nada vai ao banco)", async () => {
    localStorage.setItem("pos_sale_draft_v1", JSON.stringify(rascunho({
      installments: 2, isAdjustingInstallments: true, manualInstallments: ["300", "300"],
    })));
    render(<POS />);
    fireEvent.click(await screen.findByRole("button", { name: "Retomar venda" }));
    fireEvent.click(await screen.findByRole("button", { name: /Finalizar venda/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("quinzenal: de 15 em 15 dias", async () => {
    const args = await retomarEFinalizar(rascunho({ installments: 3, firstDueDate: "2026-09-20", paymentFrequency: "quinzenal" }));
    expect(args.p_receivables.map((r) => r.due_date)).toEqual(["2026-09-20", "2026-10-05", "2026-10-20"]);
  });

  it("pagamento misto: só a parte na carteira vira parcela", async () => {
    const args = await retomarEFinalizar(rascunho({
      splitMode: true,
      splits: [{ method: "pix", amount: 100 }, { method: "fiado", amount: 600 }],
      splitFiadoInstallments: 2,
      firstDueDate: "2026-10-31",
    }));
    expect(args.p_payment_method).toBe("misto");
    expect(args.p_receivables.map((r) => [r.due_date, r.amount])).toEqual([["2026-10-31", 300], ["2026-11-30", 300]]);
  });

  it("PIX à vista não cria conta a receber", async () => {
    const args = await retomarEFinalizar(rascunho({ paymentMethod: "pix", installments: 1 }));
    expect(args.p_payment_method).toBe("pix");
    expect(args.p_receivables).toEqual([]);
  });

  it("venda do começo ao fim clicando: produto → carrinho → cliente → dinheiro", async () => {
    tabelas.products = {
      data: [{ id: "prod1", name: "Blusa Clique", sku: "B1", price: 89.9, cost: 40, image_url: null, product_variants: [] }],
      error: null,
    };
    render(<POS />);
    fireEvent.click(await screen.findByRole("button", { name: /Blusa Clique/ }));
    // carrinho da lateral
    expect(await screen.findByText("= R$ 89,90")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Avançar/ }));

    fireEvent.click(await screen.findByRole("button", { name: /MARIA DA SILVA/ }));
    expect(screen.getByText("Nenhuma dívida")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Avançar/ }));

    expect(await screen.findByText("Forma de pagamento")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Finalizar venda/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const args = rpc.mock.calls[0][1];
    expect(args).toMatchObject({ p_customer_id: "c1", p_total: 89.9, p_payment_method: "dinheiro", p_receivables: [] });
    expect(args.p_items).toEqual([expect.objectContaining({ product_id: "prod1", quantity: 1, unit_price: 89.9 })]);
  });

  it("cadastro rápido de cliente já deixa a cliente escolhida", async () => {
    tabelas.products = {
      data: [{ id: "prod1", name: "Blusa Clique", sku: null, price: 50, cost: 20, image_url: null, product_variants: [] }],
      error: null,
    };
    tabelas.customers = { data: [{ id: "c9", name: "ANA NOVA", nickname: null, phone: null }], error: null };
    render(<POS />);
    fireEvent.click(await screen.findByRole("button", { name: /Blusa Clique/ }));
    fireEvent.click(screen.getByRole("button", { name: /Avançar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Novo cliente$/ }));
    fireEvent.change(screen.getByPlaceholderText("Nome do cliente"), { target: { value: "Ana Nova" } });
    fireEvent.click(screen.getByRole("button", { name: /Cadastrar/ }));
    // aparece na lateral como cliente da venda
    expect(await screen.findByText("ANA NOVA", { selector: "span" })).toBeInTheDocument();
  });

  it("a prévia mostra todos os vencimentos antes de finalizar", async () => {
    localStorage.setItem("pos_sale_draft_v1", JSON.stringify(rascunho({})));
    render(<POS />);
    fireEvent.click(await screen.findByRole("button", { name: "Retomar venda" }));
    const previa = await screen.findByTestId("previa-vencimentos");
    expect(previa.textContent).toContain("28/02/27");
    expect(previa.textContent).not.toContain("02/03/27");
  });
});
