import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SupplierImageSearch from "@/components/SupplierImageSearch";
import { galeriaDoEditor } from "@/lib/galeriaProduto";

const mocks = vi.hoisted(() => ({ from: vi.fn(), upload: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: mocks.from,
  functions: { invoke: mocks.invoke },
  storage: { from: () => ({ upload: mocks.upload, getPublicUrl: () => ({ data: { publicUrl: "nova.jpg" } }) }) },
} }));
vi.mock("@/lib/fotoEnviada", () => ({ problemaNaFoto: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => { vi.resetAllMocks(); mocks.upload.mockResolvedValue({ error: null }); });
afterEach(cleanup);

describe("foto enviada pelo buscador da lista", () => {
  it.each([
    { images: [], esperadas: ["nova.jpg"] },
    { images: ["antiga.jpg"], esperadas: ["nova.jpg"] },
    { images: ["antiga.jpg", "costas.jpg", "tecido.jpg"], esperadas: ["nova.jpg", "costas.jpg", "tecido.jpg"] },
  ])("grava capa e galeria juntas e reabrir preserva a nova foto: $images", async ({ images, esperadas }) => {
    const update = vi.fn((_payload: { image_url: string; images: string[] }) => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({ data: { image_url: "antiga.jpg", images }, error: null }) }) }),
      update,
    });
    const onSaved = vi.fn();
    const { container } = render(<SupplierImageSearch open onOpenChange={vi.fn()} productName="Blazer" productId="produto-1" onSaved={onSaved} />);
    const input = container.ownerDocument.querySelector("input[type=file]");
    if (!input) throw new Error("Campo de foto ausente");
    fireEvent.change(input, { target: { files: [new File(["foto"], "nova.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("nova.jpg"));
    expect(update).toHaveBeenCalledWith({ image_url: "nova.jpg", images: esperadas });
    expect(galeriaDoEditor(update.mock.calls[0][0])).toEqual(esperadas);
    expect(mocks.from.mock.calls.every(([table]) => table === "products")).toBe(true);
  });

  it("falha na leitura não sobrescreve a galeria nem anuncia foto salva", async () => {
    const update = vi.fn();
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: new Error("leitura falhou") }) }) }), update,
    });
    const onSaved = vi.fn();
    render(<SupplierImageSearch open onOpenChange={vi.fn()} productName="Blazer" productId="produto-1" onSaved={onSaved} />);
    const input = document.querySelector("input[type=file]");
    if (!input) throw new Error("Campo de foto ausente");
    fireEvent.change(input, { target: { files: [new File(["foto"], "nova.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(screen.getByText("Do computador")).toBeEnabled());
    expect(update).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});