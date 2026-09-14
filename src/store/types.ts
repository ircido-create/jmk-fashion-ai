import type { GarmentType } from "@/lib/garments";

export interface StoreVariant {
  id: string;
  size: string | null;
  color: string | null;
  /** Já limitada a 10 pelo servidor — a loja não precisa do estoque exato. */
  quantity: number;
  image_url: string | null;
}

export interface StoreProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string;
  garment_type: GarmentType | null;
  created_at: string;
  variants: StoreVariant[];
}

export interface CartLine {
  productId: string;
  variantId: string | null;
  name: string;
  image: string;
  /** Só para exibir: o servidor cobra o preço do cadastro, nunca este. */
  price: number;
  size: string | null;
  color: string | null;
  quantity: number;
  maxQty: number;
}

export interface StoreSettings {
  whatsapp: string | null;
  pickup_address: string | null;
  delivery_note: string | null;
}

export type DeliveryMethod = "retirada" | "entrega";

export interface OrderAddress {
  cep: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  state: string;
}

export interface OrderInput {
  name: string;
  phone: string;
  email?: string;
  delivery_method: DeliveryMethod;
  address?: OrderAddress;
  notes?: string;
}

/** Resumo guardado no aparelho para a tela de confirmação sobreviver a um F5. */
export interface OrderSnapshot {
  code: string;
  total: number;
  name: string;
  delivery_method: DeliveryMethod;
  lines: CartLine[];
}

/** O servidor recusa mais que isso por peça; a loja nem oferece. */
export const MAX_QTY_PER_LINE = 5;

export const lineKey = (l: { productId: string; variantId: string | null }) =>
  `${l.productId}:${l.variantId ?? "-"}`;

export const variantLabel = (v: { size: string | null; color: string | null }) =>
  [v.size, v.color].filter(Boolean).join(" · ");

/**
 * Os nomes vêm dos romaneios em caixa alta ("BL.MG.GUIPIR GLAUCIA"). Na vitrine
 * isso grita; em caixa de título lê melhor sem mudar o cadastro.
 */
export const displayName = (name: string) =>
  name.toLocaleLowerCase("pt-BR").replace(/(^|[\s(/-])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase("pt-BR"));

export const onlyDigits = (s: string) => s.replace(/\D/g, "");
