import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Registra cada consulta para conferir o que a tela pede ao banco.
type Call = { table: string; ops: [string, unknown[]][] };
const calls: Call[] = [];
const proofsTotal = { n: 50 };
const chain = (table: string) => {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "range", "or", "in", "limit", "not"]) {
    b[m] = (...a: unknown[]) => { call.ops.push([m, a]); return b; };
  }
  b.then = (ok: (v: unknown) => unknown) => {
    let result: unknown = { data: [], error: null, count: 0 };
    if (table === "payment_proofs") {
      const head = call.ops.find(([m, a]) => m === "select" && (a[1] as { head?: boolean })?.head);
      if (head) result = { data: null, error: null, count: 3 };
      else {
        const range = call.ops.find(([m]) => m === "range")?.[1] as [number, number] | undefined;
        const from = range?.[0] ?? 0;
        const rows = Array.from({ length: Math.max(0, Math.min(24, proofsTotal.n - from)) }, (_, i) => ({
          id: `p${from + i}`, created_at: "2026-09-20T12:00:00Z", storage_path: "manual/no-file/x", bucket: "payment-proofs",
          original_filename: null, mime_type: null, source: "manual", customer_id: null, ai_is_payment_proof: true,
          ai_amount: 10, ai_payer_name: `Pagador ${from + i}`, ai_bank: null, ai_transaction_id: null, ai_summary: null,
          settlement_status: "manual", settlement_note: null, settled_at: null, customers: null,
        }));
        result = { data: rows, error: null, count: proofsTotal.n };
      }
    }
    if (table === "customers" && call.ops.some(([m]) => m === "or")) result = { data: [{ id: "c1" }, { id: "c2" }], error: null };
    return Promise.resolve(result).then(ok);
  };
  return b;
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => chain(t),
    functions: { invoke: async () => ({ data: null, error: null }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PaymentProofs from "@/pages/PaymentProofs";

const proofQueries = () =>
  calls.filter((c) => c.table === "payment_proofs" && c.ops.some(([m]) => m === "range"));
const last = () => proofQueries().at(-1)!;
const op = (c: Call, name: string) => c.ops.filter(([m]) => m === name).map(([, a]) => a);

beforeEach(() => {
  calls.length = 0;
  proofsTotal.n = 50;
  localStorage.clear();
});

describe("Comprovantes — paginação e busca no servidor", () => {
  it("carrega 24 por vez e navega entre as páginas", async () => {
    render(<PaymentProofs />);
    expect(await screen.findByText("1–24 de 50 comprovante(s)")).toBeInTheDocument();
    expect(op(last(), "range")[0]).toEqual([0, 23]);
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("25–48 de 50 comprovante(s)")).toBeInTheDocument();
    expect(op(last(), "range")[0]).toEqual([24, 47]);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("49–50 de 50 comprovante(s)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();
  });

  it("a busca vai ao banco (pagador, banco, ID, cliente) e volta para a página 1", async () => {
    render(<PaymentProofs />);
    await screen.findByText("1–24 de 50 comprovante(s)");
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByText("25–48 de 50 comprovante(s)");

    fireEvent.change(screen.getByPlaceholderText(/Buscar por pagador/), { target: { value: "maria" } });
    await waitFor(() => expect(op(last(), "or").length).toBe(1), { timeout: 2000 });
    const filtro = String(op(last(), "or")[0][0]);
    expect(filtro).toContain("ai_payer_name.ilike.%maria%");
    expect(filtro).toContain("ai_transaction_id.ilike.%maria%");
    expect(filtro).toContain("customer_id.in.(c1,c2)");
    expect(op(last(), "range")[0]).toEqual([0, 23]);
  });

  it("buscar um valor procura também pelo valor exato", async () => {
    render(<PaymentProofs />);
    await screen.findByText("1–24 de 50 comprovante(s)");
    fireEvent.change(screen.getByPlaceholderText(/Buscar por pagador/), { target: { value: "150,00" } });
    await waitFor(() => expect(String(op(last(), "or")[0]?.[0] ?? "")).toContain("ai_amount.eq.150"), { timeout: 2000 });
  });

  it("vírgula ou parênteses na busca não quebram o filtro", async () => {
    render(<PaymentProofs />);
    await screen.findByText("1–24 de 50 comprovante(s)");
    fireEvent.change(screen.getByPlaceholderText(/Buscar por pagador/), { target: { value: "silva, (ana)" } });
    await waitFor(() => expect(op(last(), "or").length).toBe(1), { timeout: 2000 });
    const filtro = String(op(last(), "or")[0][0]);
    expect(filtro).toContain("ai_payer_name.ilike.%silva ana%");
  });

  it("'somente válidos' e a situação filtram no banco", async () => {
    render(<PaymentProofs />);
    await screen.findByText("1–24 de 50 comprovante(s)");
    fireEvent.click(screen.getByRole("button", { name: /Aguardando baixa manual/ }));
    await waitFor(() => expect(op(last(), "eq")).toContainEqual(["settlement_status", "pendente"]));
    fireEvent.click(screen.getByRole("switch", { name: /Mostrar apenas comprovantes válidos/ }));
    await waitFor(() => expect(op(last(), "eq")).toContainEqual(["ai_is_payment_proof", true]));
  });

  it("seletor de clientes carrega todos, não só os 500 primeiros", async () => {
    render(<PaymentProofs />);
    await screen.findByText("1–24 de 50 comprovante(s)");
    const custLoad = calls.find((c) => c.table === "customers" && c.ops.some(([m]) => m === "range"));
    expect(custLoad).toBeTruthy(); // fetchAll pagina com range em vez de limit(500)
    expect(op(custLoad!, "limit")).toEqual([]);
  });
});
