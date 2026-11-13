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
    compare_at_price: p.compare_at_price == null ? null : Number(p.compare_at_price),
    image_url: p.image_url,
    images: Array.isArray(p.images) ? p.images.filter(Boolean) : [],
    garment_type: isGarmentType(p.garment_type) ? p.garment_type : null,
    created_at: p.created_at,
    variants: Array.isArray(p.variants) ? (p.variants as unknown as StoreVariant[]) : [],
  }));
}

/**
 * As configurações que a vitrine mostra à cliente.
 *
 * Vem por função, e não por leitura da tabela: `store_settings` guarda também
 * o WhatsApp interno que recebe o aviso de pedido e as chaves do link de
 * pagamento, e a regra antiga (`USING (true)` para anônimo) deixava a tabela
 * inteira ao alcance de qualquer visitante — era um dos dois avisos de
 * segurança do painel, em 13/11/2026. A função devolve só estes quatro campos
 * (migração 20261113190000).
 */
export async function fetchStoreSettings(): Promise<StoreSettings> {
  const vazio: StoreSettings = {
    whatsapp: null, pickup_address: null, delivery_note: null, reserve_hours: null,
  };
  const { data, error } = await supabase.rpc("store_settings_publicas");
  if (error) throw error;
  return (data as StoreSettings[] | null)?.[0] ?? vazio;
}

/** O prazo que a loja guarda a peça, do jeito que a cliente lê. */
export const HORAS_DE_RESERVA_PADRAO = 12;

export function horasDeReserva(settings: StoreSettings | null): number {
  const h = Number(settings?.reserve_hours);
  return Number.isFinite(h) && h > 0 ? Math.round(h) : HORAS_DE_RESERVA_PADRAO;
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

export interface OrderPayment {
  status: "rascunho" | "aguardando" | "pago" | "estornado" | "cancelado" | "expirado" | "falhou";
  link_url: string | null;
  expira_em: string | null;
  valor_centavos: number;
}

/**
 * Situação do pagamento do pedido, pelo código que a cliente acabou de receber.
 * A função do banco devolve só link e situação — nada de nome, telefone ou
 * endereço, que é o motivo de esta tela nunca ter consultado o banco antes.
 */
export async function fetchOrderPayment(code: string): Promise<OrderPayment | null> {
  const { data, error } = await supabase.rpc("store_order_payment", { p_code: code });
  if (error) return null;
  return (data as unknown as OrderPayment) ?? null;
}

/**
 * Guarda as provas desta visita no próprio aparelho, em memória.
 *
 * A tela promete que a foto não fica guardada — então nada disto sai do
 * navegador nem é escrito em disco: é um Map que morre quando a cliente fecha
 * a aba. Serve para o caminho mais comum do provador: provar o vestido A,
 * trocar para o B e voltar para o A. Na volta a imagem aparece na hora, sem os
 * ~15 segundos da IA e sem gastar uma das 6 provas por hora.
 */
const MAX_PROVAS_GUARDADAS = 3;
const provas = new Map<string, string>();

async function chaveDaProva(photo: string, productIds: string[]): Promise<string> {
  const base = `${[...productIds].sort().join(",")}|${photo}`;
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const hash = await subtle.digest("SHA-256", new TextEncoder().encode(base));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // navegador sem crypto.subtle (fora de https): hash simples, só para a chave do Map
  let h = 5381;
  for (let i = 0; i < base.length; i++) h = ((h * 33) ^ base.charCodeAt(i)) >>> 0;
  return `djb2-${h}-${base.length}`;
}

function guardarProva(chave: string, image: string) {
  provas.set(chave, image);
  while (provas.size > MAX_PROVAS_GUARDADAS) {
    const maisAntiga: string | undefined = provas.keys().next().value;
    if (maisAntiga === undefined) break;
    provas.delete(maisAntiga);
  }
}

/** Esta foto com estas peças já foi provada nesta visita? Então devolve na hora. */
export async function peekTryOn(photo: string, productIds: string[]): Promise<string | null> {
  return provas.get(await chaveDaProva(photo, productIds)) ?? null;
}

/** Chama o provador. Os erros da função já vêm escritos para a cliente. */
export async function tryOn(photo: string, productIds: string[]): Promise<string> {
  const chave = await chaveDaProva(photo, productIds);
  const guardada = provas.get(chave);
  if (guardada) return guardada;

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
  guardarProva(chave, data.image);
  return data.image;
}

/**
 * Devolve a foto no formato que ficar menor. Navegador que não grava WebP não
 * dá erro em toDataURL: devolve PNG, que é muito maior — por isso a comparação
 * em vez de confiar no formato pedido.
 */
function menorFormato(canvas: HTMLCanvasElement): string {
  const jpeg = canvas.toDataURL("image/jpeg", 0.88);
  const webp = canvas.toDataURL("image/webp", 0.82);
  return webp.startsWith("data:image/webp") && webp.length < jpeg.length ? webp : jpeg;
}

/**
 * Reduz a foto no próprio aparelho antes de enviar. Foto de celular passa de
 * 4 MB; em 1536 px a IA enxerga o mesmo, o envio fica rápido no 4G e o limite
 * da função nunca é atingido.
 *
 * Medido em 11/11/2026, chamando a função direto: baixar de 1536 px para
 * 1024 px NÃO deixa a IA mais rápida (14,9 s contra 15,2 s) — o tempo é o
 * desenho da imagem de saída, não a leitura da foto. Então os 1536 px ficam,
 * porque provam melhor, e o que se economiza é o envio: a mesma foto em WebP
 * sai bem mais leve que em JPEG, e isso a cliente sente no 4G.
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
      resolve(menorFormato(canvas));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler essa imagem. Tente uma foto em JPG ou PNG."));
    };
    img.src = url;
  });
}
