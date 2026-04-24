/**
 * Conciliação de extrato com contas a receber.
 *
 * Regra: para cada pagamento (cliente + valor), abate as parcelas pendentes
 * desse cliente da MAIS ANTIGA primeiro. Quita integralmente até esgotar o saldo.
 * Se sobrar saldo que não cubra a próxima parcela inteira, REDUZ o valor daquela
 * parcela ao saldo restante (a parcela permanece pendente, agora com valor menor).
 */

import { digitsOnly } from "@/lib/taxId";

export interface ReceivableLite {
  id: string;
  customer_id: string | null;
  customer_name: string;
  customer_tax_id?: string | null;
  amount: number;
  due_date: string; // YYYY-MM-DD
  status: string;
}

export interface PaymentRow {
  customer_name: string;
  tax_id: string;
  amount: number;
  payment_date: string; // YYYY-MM-DD
  description?: string;
  /** linha original do arquivo (1-based, p/ debug) */
  line?: number;
}

export type ActionKind = "settle" | "reduce";

export interface ReconciliationAction {
  kind: ActionKind;
  receivable_id: string;
  customer_name: string;
  due_date: string;
  original_amount: number;
  /** valor abatido nessa receivable a partir do(s) pagamento(s) */
  amount_paid: number;
  /** se kind==="reduce", novo valor que a parcela passará a ter */
  new_amount?: number;
  /** índices dos pagamentos que contribuíram p/ essa ação */
  payment_indices: number[];
}

export interface ReconciliationResult {
  actions: ReconciliationAction[];
  /** pagamentos sem nenhum match de cliente */
  unmatchedPayments: { payment: PaymentRow; reason: string }[];
  /** pagamentos com sobra que não consumiu nada (já não há parcelas) */
  leftovers: { customer_name: string; customer_id: string | null; amount: number; payment_indices: number[] }[];
  totals: {
    payments: number;
    paymentsSum: number;
    fullySettled: number;
    partiallyReduced: number;
    paidSum: number;
    unmatched: number;
  };
}

const norm = (s: string) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** indexa receivables pendentes por customer_id e por chaves alternativas (tax_id / nome normalizado) */
export function reconcile(
  receivables: ReceivableLite[],
  payments: PaymentRow[]
): ReconciliationResult {
  // Apenas pendentes/vencidos podem receber baixa
  const pendings = receivables.filter((r) => r.status !== "pago" && r.status !== "cancelado");

  // Agrupa por customer_id (quando existe)
  const byCustomerId = new Map<string, ReceivableLite[]>();
  // Índices auxiliares para resolver pagamento → customer_id
  const taxToCustomerId = new Map<string, string>();
  const nameToCustomerId = new Map<string, string>();

  for (const r of pendings) {
    if (!r.customer_id) continue;
    const arr = byCustomerId.get(r.customer_id) ?? [];
    arr.push(r);
    byCustomerId.set(r.customer_id, arr);
    const tax = digitsOnly(r.customer_tax_id ?? "");
    if (tax) taxToCustomerId.set(tax, r.customer_id);
    const nm = norm(r.customer_name);
    if (nm) nameToCustomerId.set(nm, r.customer_id);
  }

  // Ordena cada bucket por due_date asc (mais antigo primeiro), depois por amount asc
  for (const arr of byCustomerId.values()) {
    arr.sort((a, b) =>
      a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.amount - b.amount
    );
  }

  // Estado mutável: saldo restante por receivable_id
  const remaining = new Map<string, number>();
  for (const r of pendings) remaining.set(r.id, Number(r.amount));

  // Acumula pagamentos por customer_id (somando todas as linhas do extrato do mesmo cliente)
  interface PaymentBucket {
    customer_id: string;
    customer_name: string;
    total: number;
    indices: number[];
  }
  const buckets = new Map<string, PaymentBucket>();
  const unmatched: ReconciliationResult["unmatchedPayments"] = [];

  payments.forEach((p, idx) => {
    if (!(p.amount > 0)) return;
    const tax = digitsOnly(p.tax_id);
    let cid: string | null = null;
    if (tax && taxToCustomerId.has(tax)) cid = taxToCustomerId.get(tax)!;
    if (!cid) {
      const nm = norm(p.customer_name);
      if (nm && nameToCustomerId.has(nm)) cid = nameToCustomerId.get(nm)!;
    }
    if (!cid) {
      unmatched.push({
        payment: p,
        reason: "Cliente não tem contas a receber pendentes",
      });
      return;
    }
    const b = buckets.get(cid) ?? {
      customer_id: cid,
      customer_name: p.customer_name,
      total: 0,
      indices: [],
    };
    b.total += Number(p.amount);
    b.indices.push(idx);
    if (!b.customer_name) b.customer_name = p.customer_name;
    buckets.set(cid, b);
  });

  const actions: ReconciliationAction[] = [];
  const leftovers: ReconciliationResult["leftovers"] = [];

  // Para cada cliente, abate parcelas mais antigas até esgotar
  for (const b of buckets.values()) {
    let pool = round2(b.total);
    const parcels = byCustomerId.get(b.customer_id) ?? [];
    for (const r of parcels) {
      if (pool <= 0.005) break;
      const left = round2(remaining.get(r.id) ?? 0);
      if (left <= 0.005) continue;
      if (pool + 0.005 >= left) {
        // quita integralmente
        actions.push({
          kind: "settle",
          receivable_id: r.id,
          customer_name: r.customer_name,
          due_date: r.due_date,
          original_amount: Number(r.amount),
          amount_paid: left,
          payment_indices: [...b.indices],
        });
        remaining.set(r.id, 0);
        pool = round2(pool - left);
      } else {
        // parcial: reduz a parcela
        actions.push({
          kind: "reduce",
          receivable_id: r.id,
          customer_name: r.customer_name,
          due_date: r.due_date,
          original_amount: Number(r.amount),
          amount_paid: pool,
          new_amount: round2(left - pool),
          payment_indices: [...b.indices],
        });
        remaining.set(r.id, round2(left - pool));
        pool = 0;
      }
    }
    if (pool > 0.005) {
      leftovers.push({
        customer_name: b.customer_name,
        customer_id: b.customer_id,
        amount: pool,
        payment_indices: [...b.indices],
      });
    }
  }

  const fullySettled = actions.filter((a) => a.kind === "settle").length;
  const partiallyReduced = actions.filter((a) => a.kind === "reduce").length;
  const paidSum = round2(actions.reduce((s, a) => s + a.amount_paid, 0));
  const paymentsSum = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));

  return {
    actions,
    unmatchedPayments: unmatched,
    leftovers,
    totals: {
      payments: payments.length,
      paymentsSum,
      fullySettled,
      partiallyReduced,
      paidSum,
      unmatched: unmatched.length,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
