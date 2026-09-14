import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isGarmentType } from "@/lib/garments";
import type { CartLine, OrderInput, StoreProduct, StoreSettings, StoreVariant } from "./types";

/**
 * Acesso da loja ao banco. A loja roda sem login: tudo passa por funções que
 * expõem só o público (store_catalog) ou conferem preço e estoque no servidor
 * (store_place_order). Nenhuma tabela do administrativo é lida direto daqui.
 */

export async function fetchCatalog(): Promise<StoreProduct[]> {
  const { data, error } = await supabase.rpc("store_catalog");
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: Number(p.price),
    image_url: p.image_url,
    garment_type: isGarmentType(p.garment_type) ? p.garment_type : null,
    created_at: p.created_at,
    variants: Array.isArray(p.variants) ? (p.variants as unknown as StoreVariant[]) : [],
  }));
}

export async function fetchStoreSettings(): Promise<StoreSettings> {
  const { data, error } = await supabase
    .from("store_settings")
    .select("whatsapp, pickup_address, delivery_note")
    .maybeSingle();
  if (error) throw error;
  return data ?? { whatsapp: null, pickup_address: null, delivery_note: null };
}

/**
 * As mensagens de RAISE EXCEPTION da função já são escritas para a cliente
 * ("Estoque insuficiente para ..."). Erro técnico do banco não é.
 */
function friendlyDbError(message: string) {
  if (/invalid input syntax|violates|function .* does not exist|permission denied/i.test(message)) {
    return "Não foi possível enviar o pedido. Atualize a página e tente de novo.";
  }
  return message;
}

export async function placeOrder(order: OrderInput, lines: CartLine[]) {
  const { data, error } = await supabase.rpc("store_place_order", {
    p_order: order as unknown as Json,
    p_items: lines.map((l) => ({
      product_id: l.productId,
      variant_id: l.variantId,
      quantity: l.quantity,
    })) as unknown as Json,
  });
  if (error) throw new Error(friendlyDbError(error.message));
  const r = data as { code: string; total: number };
  return { code: r.code, total: Number(r.total) };
}

/** Chama o provador. Os erros da função já vêm escritos para a cliente. */
export async function tryOn(photo: string, productIds: string[]): Promise<string> {
  const { data, error } = await supabase.functions.invoke("store-try-on", {
    body: { photo, product_ids: productIds },
  });
  if (error) {
    let message = "Não foi possível gerar o provador agora. Tente de novo em instantes.";
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const body = await ctx.json();
        if (typeof body?.error === "string") message = body.error;
      } catch {
        // corpo não era JSON: fica a mensagem genérica
      }
    }
    throw new Error(message);
  }
  if (typeof data?.image !== "string") throw new Error("A IA não devolveu a imagem. Tente outra foto.");
  return data.image;
}

/**
 * Reduz a foto no próprio aparelho antes de enviar. Foto de celular passa de
 * 4 MB; em 1536 px a IA enxerga o mesmo, o envio fica rápido no 4G e o limite
 * da função nunca é atingido.
 */
export function downscalePhoto(file: File, max = 1536): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx) {
        reject(new Error("Seu navegador não conseguiu preparar a foto."));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler essa imagem. Tente uma foto em JPG ou PNG."));
    };
    img.src = url;
  });
}
