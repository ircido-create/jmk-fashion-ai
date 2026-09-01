// Tipos e constantes compartilhados pelo PDV e pelos componentes que ele monta.

export type PaymentMethod = "dinheiro" | "debito" | "credito" | "pix" | "fiado";
export type Step = 1 | 2 | 3;
export type DiscountType = "valor" | "percent";
export type PaymentFrequency = "mensal" | "quinzenal";

export interface SplitEntry {
  method: PaymentMethod;
  amount: number;
}

export interface Variant {
  id: string;
  size: string | null;
  color: string | null;
  quantity: number;
  sku: string | null;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  cost: number;
  image_url: string | null;
  product_variants: Variant[];
}

export interface Customer {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
}

export interface CartItem {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  maxQty: number;
  isAvulso?: boolean;
}

/** Dados congelados no momento da venda, para impressão do cupom. */
export interface ReceiptData {
  number: string;
  date: Date;
  customer: Customer | null;
  items: CartItem[];
  subtotal: number;
  grossSubtotal?: number;
  discount?: number;
  payment: PaymentMethod | "misto";
  installments: number;
  cashReceived: number;
  change: number;
  splits?: SplitEntry[];
}

export const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  debito: "Cartão de Débito",
  credito: "Cartão de Crédito",
  pix: "PIX",
  fiado: "Carteira",
  misto: "Pagamento Misto",
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const addPeriod = (date: Date, n: number, freq: PaymentFrequency) => {
  const d = new Date(date);
  if (freq === "quinzenal") {
    d.setDate(d.getDate() + n * 15);
  } else {
    d.setMonth(d.getMonth() + n);
  }
  return d;
};

/**
 * Parcela a criar junto com a venda. `type` e não `interface` de propósito:
 * aliases ganham index signature implícita e são aceitos onde o cliente do
 * Supabase espera `Json`.
 */
export type ReceivableDraft = {
  customer_id: string;
  amount: number;
  due_date: string;
  description: string;
  status: string;
};
