import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
import { galeriaComNovaCapa } from "@/lib/galeriaProduto";

// Execute the actual edge handler with isolated API/storage doubles: no real writes.
async function salvar(images: string[], readError: { message: string } | null = null) {
  const update = vi.fn((_payload: { image_url: string; images: string[] }) => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  const from = vi.fn((_table: string) => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: { image_url: "antiga.jpg", images }, error: readError }) }) }),
    update,
  }));
  const client = {
    from,
    auth: { getUser: async () => ({ data: { user: { id: "usuario-teste" } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "nova.jpg" } }) }) },
  };
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const source = readFileSync("supabase/functions/find-product-image/index.ts", "utf8")
    .replace(/^import .*;\r?\n/gm, "");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(js, {
    createClient: () => client, galeriaComNovaCapa, Request, Response, Uint8Array, URL,
    console: { error: vi.fn() },
    fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
    Deno: { env: { get: () => "test-only" }, serve: (fn: typeof handler) => { handler = fn; } },
  });
  if (!handler) throw new Error("Handler não registrado");
  const response = await handler(new Request("http://localhost/save", {
    method: "POST", headers: { Authorization: "test-only", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save", product_id: "produto-1", image_url: "https://example.test/foto.jpg" }),
  }));
  return { response, update, from };
}

describe("salvar foto encontrada pelo fornecedor", () => {
  it.each([
    { images: [], esperadas: ["nova.jpg"] },
    { images: ["antiga.jpg"], esperadas: ["nova.jpg"] },
    { images: ["antiga.jpg", "costas.jpg", "tecido.jpg"], esperadas: ["nova.jpg", "costas.jpg", "tecido.jpg"] },
  ])("persiste nova capa e galeria sem tocar em variações: $images", async ({ images, esperadas }) => {
    const { response, update, from } = await salvar(images);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ image_url: "nova.jpg" });
    expect(update).toHaveBeenCalledWith({ image_url: "nova.jpg", images: esperadas });
    expect(from.mock.calls).toEqual([["products"], ["products"]]);
  });

  it("não sobrescreve fotos quando não consegue ler a galeria atual", async () => {
    const { response, update } = await salvar(["antiga.jpg", "detalhe.jpg"], { message: "leitura falhou" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "leitura falhou" });
    expect(update).not.toHaveBeenCalled();
  });
});