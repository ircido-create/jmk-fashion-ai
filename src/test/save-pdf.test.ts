import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock sobe para o topo do arquivo, antes das consts: o mock precisa criar
// as funções por dentro e expô-las por uma variável com prefixo "mock".
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: mockToast }));

import { salvarPdf } from "@/lib/savePdf";

const toastSuccess = mockToast.success;
const toastError = mockToast.error;

const docFalso = (blob?: unknown) =>
  ({ output: () => blob ?? new Blob(["%PDF-1.4"], { type: "application/pdf" }) }) as never;

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
});

describe("Salvar PDF", () => {
  it("baixa o arquivo com o nome certo e avisa a pessoa", () => {
    let baixado: string | null = null;
    const criar = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = criar(tag) as HTMLAnchorElement;
      if (tag === "a") el.click = () => { baixado = el.download; };
      return el;
    });

    salvarPdf(docFalso(), "contas-a-receber-123.pdf");

    expect(baixado).toBe("contas-a-receber-123.pdf");
    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("navegador que recusa o download abre o PDF numa aba", () => {
    const criar = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = criar(tag) as HTMLAnchorElement;
      if (tag === "a") el.click = () => { throw new Error("download bloqueado"); };
      return el;
    });
    const abrir = vi.fn(() => ({}) as Window);
    vi.stubGlobal("open", abrir);

    salvarPdf(docFalso(), "x.pdf");

    expect(abrir).toHaveBeenCalledWith("blob:fake", "_blank", "noopener");
    expect(toastSuccess).toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("bloqueio total avisa em vez de ficar em silêncio", () => {
    const criar = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = criar(tag) as HTMLAnchorElement;
      if (tag === "a") el.click = () => { throw new Error("bloqueado"); };
      return el;
    });
    vi.stubGlobal("open", vi.fn(() => null));

    salvarPdf(docFalso(), "x.pdf");

    expect(toastError).toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("PDF que não monta não fica em silêncio", () => {
    const doc = { output: () => { throw new Error("estourou a memória"); } } as never;

    salvarPdf(doc, "x.pdf");

    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
