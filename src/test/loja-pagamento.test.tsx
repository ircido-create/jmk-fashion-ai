import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// A tela de "pedido recebido" lê o resumo do próprio aparelho e consulta só o
// pagamento no banco. Aqui a consulta é uma fachada.
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  },
}));
vi.mock("@/store/StoreContext", () => ({
  useStore: () => ({ settings: { whatsapp: "5511967842865", pickup_address: null, delivery_note: null } }),
}));

import StoreOrderDone from "@/store/pages/StoreOrderDone";

const abrir = (code = "ABC123") =>
  render(
    <MemoryRouter initialEntries={[`/loja/pedido/${code}`]}>
      <Routes>
        <Route path="/loja/pedido/:code" element={<StoreOrderDone />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  rpc.mockReset();
  sessionStorage.clear();
});

describe("Loja — pagamento do pedido", () => {
  it("mostra o botão de pagar quando a InfinitePay devolveu o link", async () => {
    rpc.mockResolvedValue({
      data: { status: "aguardando", link_url: "https://checkout.infinitepay.io/abc", valor_centavos: 15000 },
      error: null,
    });

    abrir();

    const botao = await screen.findByRole("link", { name: /Pagar agora/ });
    expect(botao.getAttribute("href")).toBe("https://checkout.infinitepay.io/abc");
    expect(rpc).toHaveBeenCalledWith("store_order_payment", { p_code: "ABC123" });
  });

  it("sem link, a cliente só vê o caminho de sempre (falar com a loja)", async () => {
    rpc.mockResolvedValue({ data: { status: "rascunho", link_url: null, valor_centavos: 15000 }, error: null });

    abrir();

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Pagar agora/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Falar com a loja/ })).toBeTruthy();
  });

  it("pedido já pago não oferece pagar de novo", async () => {
    rpc.mockResolvedValue({
      data: { status: "pago", link_url: null, valor_centavos: 15000 },
      error: null,
    });

    abrir();

    expect(await screen.findByText(/Pagamento confirmado/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Pagar agora/ })).toBeNull();
  });

  it("link vencido não aparece: o banco devolve a situação sem a URL", async () => {
    rpc.mockResolvedValue({ data: { status: "expirado", link_url: null, valor_centavos: 15000 }, error: null });

    abrir();

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Pagar agora/ })).toBeNull();
  });

  it("falha na consulta não quebra a confirmação do pedido", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "rede" } });

    abrir("Z9Z9Z9");

    expect(await screen.findByText(/Pedido #Z9Z9Z9/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Pagar agora/ })).toBeNull();
  });
});
