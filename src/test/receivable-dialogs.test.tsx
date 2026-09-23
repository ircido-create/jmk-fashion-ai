import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
const insert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ insert: (...a: unknown[]) => insert(...a) }),
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const exportPdf = vi.fn();
vi.mock("@/lib/financePdf", () => ({ exportReceivablePdf: (...a: unknown[]) => exportPdf(...a) }));

import BulkReconcileDialog from "@/components/receivable/BulkReconcileDialog";
import ImportReceivablesDialog from "@/components/receivable/ImportReceivablesDialog";
import ReceivableReportDialog from "@/components/receivable/ReceivableReportDialog";
import type { Customer, Receivable } from "@/components/receivable/types";

const customers: Customer[] = [{ id: "c1", name: "MARIA DA SILVA", nickname: null, tax_id: "12345678900", phone: null }];
const list: Receivable[] = [
  { id: "r1", customer_id: "c1", description: "p1", amount: 100, due_date: "2026-08-10", status: "vencido", paid_at: null },
  { id: "r2", customer_id: "c1", description: "p2", amount: 100, due_date: "2026-09-10", status: "vencido", paid_at: null },
];

const csv = (conteudo: string, nome = "extrato.csv") => new File([conteudo], nome, { type: "text/csv" });

beforeEach(() => {
  rpc.mockReset();
  insert.mockReset();
  toastError.mockReset();
  exportPdf.mockReset();
});

describe("BulkReconcileDialog (baixa em massa)", () => {
  it("lê o extrato, mostra a conciliação e aplica numa única chamada ao banco", async () => {
    rpc.mockResolvedValue({ data: { proof_id: "p", settled: 1, reduced: 1, paid_total: 150 }, error: null });
    const onApplied = vi.fn();
    const onOpenChange = vi.fn();
    render(<BulkReconcileDialog open onOpenChange={onOpenChange} list={list} customers={customers} onApplied={onApplied} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csv("Cliente,CPF,Valor\nMaria da Silva,123.456.789-00,\"150,00\"\n")] } });

    const aplicar = await screen.findByRole("button", { name: "Aplicar baixa (2)" });
    expect(screen.getByText("Quitado")).toBeInTheDocument();
    expect(screen.getByText(/restará R\$ 50\.00/)).toBeInTheDocument();

    fireEvent.click(aplicar);
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("apply_receivable_payment");
    expect(rpc.mock.calls[0][1].p_actions).toEqual([
      { receivable_id: "r1", kind: "settle", amount_paid: 100, expected_amount: 100 },
      { receivable_id: "r2", kind: "reduce", amount_paid: 50, expected_amount: 100 },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("pagamento de quem não tem parcela aparece em 'Não conciliados' e não habilita a baixa", async () => {
    render(<BulkReconcileDialog open onOpenChange={vi.fn()} list={list} customers={customers} onApplied={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csv("Cliente,Valor\nOutra Pessoa,80\n")] } });
    expect(await screen.findByText("Não conciliados")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar baixa (0)" })).toBeDisabled();
  });

  it("erro do banco aparece para o usuário e não fecha o diálogo", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "O valor da parcela mudou" } });
    const onApplied = vi.fn();
    render(<BulkReconcileDialog open onOpenChange={vi.fn()} list={list} customers={customers} onApplied={onApplied} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csv("Cliente,Valor\nMaria da Silva,100\n")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar baixa (1)" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("O valor da parcela mudou"));
    expect(onApplied).not.toHaveBeenCalled();
  });
});

describe("ImportReceivablesDialog (importar)", () => {
  it("marca como duplicada a conta que já existe e importa só as novas", async () => {
    insert.mockReturnValue(Promise.resolve({ error: null }));
    const onImported = vi.fn();
    render(<ImportReceivablesDialog open onOpenChange={vi.fn()} list={list} customers={customers} onImported={onImported} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [csv("Cliente,CPF,Valor,Vencimento\nMaria da Silva,12345678900,100,10/08/2026\nMaria da Silva,12345678900,120,10/10/2026\n")] },
    });

    expect(await screen.findByText(/já existe no sistema/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar 1" }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(insert).toHaveBeenCalledWith([{ customer_id: "c1", description: null, amount: 120, due_date: "2026-10-10" }]);
  });
});

describe("ReceivableReportDialog (relatório)", () => {
  it("gera o PDF com os títulos filtrados", () => {
    render(<ReceivableReportDialog open onOpenChange={vi.fn()} rows={list} filterLabel="A Receber" />);
    expect(screen.getByText(/2 título\(s\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Gerar PDF/ }));
    expect(exportPdf).toHaveBeenCalledWith(list, "A Receber • todos os períodos");
  });

  it("avisa quando não há títulos", () => {
    render(<ReceivableReportDialog open onOpenChange={vi.fn()} rows={[]} filterLabel="Pago" />);
    fireEvent.click(screen.getByRole("button", { name: /Gerar PDF/ }));
    expect(toastError).toHaveBeenCalledWith("Nenhum lançamento no período selecionado");
    expect(exportPdf).not.toHaveBeenCalled();
  });
});
