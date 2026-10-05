import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
// Parcelas em aberto da venda: 2 de R$ 150
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [{ amount: 150 }, { amount: 150 }], error: null }),
        }),
      }),
    }),
  },
}));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a), info: vi.fn() },
}));

import SaleItemsDialog, { type SaleItemsDialogSale } from "@/components/sales/SaleItemsDialog";

const venda: SaleItemsDialogSale = {
  id: "s1",
  total: 300,
  payment_method: "fiado",
  customers: { name: "MARIA DA SILVA" },
  sale_items: [
    { id: "i1", product_name: "Saia Gabi", variant_label: "M", quantity: 2, unit_price: 100 },
    { id: "i2", product_name: "Blusa Mila", variant_label: null, quantity: 1, unit_price: 100 },
  ],
};

beforeEach(() => {
  rpc.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("SaleItemsDialog (alterar / excluir item da venda)", () => {
  it("mostra a prévia e altera a quantidade numa única chamada ao banco", async () => {
    rpc.mockResolvedValue({ data: { total_anterior: 300, total_novo: 200, parcelas_ajustadas: 2 }, error: null });
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(<SaleItemsDialog sale={venda} onClose={onClose} onChanged={onChanged} />);
    await screen.findByText(/2 parcela\(s\) em aberto/);

    fireEvent.change(screen.getByLabelText("Quantidade de Saia Gabi"), { target: { value: "1" } });
    fireEvent.click(screen.getAllByTitle("Salvar quantidade")[0]);

    expect(screen.getByText("Alterar Saia Gabi (M) de 2 para 1?")).toBeInTheDocument();
    expect(screen.getByText(/1 peça\(s\) voltam ao estoque/)).toBeInTheDocument();
    expect(screen.getByText(/dividida igualmente entre as 2 parcela/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("alterar_item_venda", { p_item_id: "i1", p_nova_quantidade: 1 });
    expect(onClose).toHaveBeenCalled();
  });

  it("excluir item manda quantidade 0; erro do banco aparece e nada é recarregado", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "A diferença (R$ 100,00) é maior que o saldo em aberto da venda" } });
    const onChanged = vi.fn();
    render(<SaleItemsDialog sale={venda} onClose={vi.fn()} onChanged={onChanged} />);
    await screen.findByText(/2 parcela\(s\) em aberto/);

    fireEvent.click(screen.getAllByTitle("Excluir item")[1]);
    expect(screen.getByText("Excluir 1× Blusa Mila?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Excluir item" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/maior que o saldo/)));
    expect(rpc).toHaveBeenCalledWith("alterar_item_venda", { p_item_id: "i2", p_nova_quantidade: 0 });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("não deixa excluir o único item da venda", async () => {
    render(
      <SaleItemsDialog sale={{ ...venda, sale_items: [venda.sale_items[0]] }} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(await screen.findByTitle("Único item — exclua a venda inteira")).toBeDisabled();
  });
});
