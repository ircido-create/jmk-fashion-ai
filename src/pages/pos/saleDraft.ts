import type {
  CartItem, Customer, DiscountType, PaymentFrequency, PaymentMethod, SplitEntry, Step,
} from "./types";

/**
 * Rascunho da venda em andamento, guardado no próprio aparelho.
 *
 * O PDV mantinha carrinho, cliente e pagamento só em memória: sair para outra
 * tela, atualizar a página ou o navegador do celular descartar a aba apagava o
 * atendimento pela metade e obrigava a lançar tudo de novo. O rascunho é salvo
 * a cada mudança e oferecido de volta na próxima abertura do PDV.
 *
 * Só sai daqui por decisão explícita: venda finalizada, "Limpar", ou "Descartar"
 * na retomada. Erro de gravação nunca derruba a venda — o PDV segue sem a rede.
 */

const KEY = "pos_sale_draft_v1";

export interface SaleDraft {
  savedAt: string;
  step: Step;
  cart: CartItem[];
  discountValue: string;
  discountType: DiscountType;
  customerId: string;
  selectedCustomer: Customer | null;
  paymentMethod: PaymentMethod;
  installments: number;
  generateReceivables: boolean;
  cashReceived: string;
  notes: string;
  firstDueDate: string;
  paymentFrequency: PaymentFrequency;
  manualInstallments: string[];
  isAdjustingInstallments: boolean;
  splitMode: boolean;
  splits: SplitEntry[];
  splitMethod: PaymentMethod;
  splitAmount: string;
  splitFiadoInstallments: number;
}

export function saveDraft(draft: SaleDraft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Cota estourada ou storage bloqueado (aba anônima, cookies barrados).
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Idem: sem storage não há o que limpar.
  }
}

/** Devolve o rascunho apenas se ainda tiver itens — carrinho vazio não é venda. */
export function loadDraft(): SaleDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaleDraft;
    if (!d || !Array.isArray(d.cart) || d.cart.length === 0) return null;
    return d;
  } catch {
    // JSON corrompido ou de uma versão antiga do formato: melhor ignorar.
    return null;
  }
}
