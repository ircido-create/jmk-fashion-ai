import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { StoreProduct, StoreVariant } from "@/store/types";

// A loja inteira depende do contexto (catálogo, sacola, provador). Aqui só
// interessa a tela da peça, então o contexto é uma fachada fixa.
const addToCart = vi.fn();
let catalogo: StoreProduct[] = [];
vi.mock("@/store/StoreContext", () => ({
  useStore: () => ({
    catalog: catalogo,
    productById: new Map(catalogo.map((p) => [p.id, p])),
    loading: false,
    addToCart,
    setLookPiece: () => false,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import StoreProductPage from "@/store/pages/StoreProduct";

const variante = (over: Partial<StoreVariant> = {}): StoreVariant => ({
  id: "v1", size: null, color: null, quantity: 3, image_url: null, ...over,
});

const peca = (variants: StoreVariant[]): StoreProduct => ({
  id: "p1",
  name: "VESTIDO TUBO ELAINE",
  description: null,
  price: 150,
  image_url: "https://exemplo/foto.jpg",
  images: [],
  garment_type: "vestido",
  created_at: "2026-10-28T12:00:00Z",
  variants,
});

const abrir = (p: StoreProduct) => {
  catalogo = [p];
  render(
    <MemoryRouter initialEntries={["/loja/produto/p1"]}>
      <Routes>
        <Route path="/loja/produto/:id" element={<StoreProductPage />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("Loja — tamanho e cor da peça", () => {
  it("mostra o tamanho e a cor mesmo quando só existe uma opção", () => {
    abrir(peca([variante({ size: "M", color: "Preto" })]));

    expect(screen.getByText("Tamanho")).toBeTruthy();
    expect(screen.getByRole("button", { name: "M" })).toBeTruthy();
    expect(screen.getByText("Cor")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preto" })).toBeTruthy();
  });

  it("a opção única já vem escolhida, então dá para adicionar à sacola direto", () => {
    abrir(peca([variante({ id: "v9", size: "G", color: "Vinho" })]));

    screen.getByRole("button", { name: /Adicionar à sacola/ }).click();

    expect(addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: "v9", size: "G", color: "Vinho", quantity: 1 }),
    );
  });

  it("com vários tamanhos, mostra todos para escolher", () => {
    abrir(peca([
      variante({ id: "v1", size: "P", color: "Preto" }),
      variante({ id: "v2", size: "M", color: "Preto" }),
      variante({ id: "v3", size: "G", color: "Preto" }),
    ]));

    for (const t of ["P", "M", "G"]) expect(screen.getByRole("button", { name: t })).toBeTruthy();
  });

  it("peça sem tamanho nem cor cadastrados não inventa opção nenhuma", () => {
    abrir(peca([]));

    expect(screen.queryByText("Tamanho")).toBeNull();
    expect(screen.queryByText("Cor")).toBeNull();
  });
});
