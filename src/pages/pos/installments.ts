/**
 * Parcelas da venda na carteira (fiado) ou no crédito com contas a receber.
 * Tirado de POS.tsx para ser testável — é a conta que vira dívida da cliente.
 */
import { parseAmount } from "@/lib/spreadsheet";
import type { PaymentFrequency, PaymentMethod } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CarteiraInput {
  splitMode: boolean;
  paymentMethod: PaymentMethod;
  generateReceivables: boolean;
  total: number;
  installments: number;
  splits: { method: PaymentMethod; amount: number }[];
  splitFiadoInstallments: number;
}

/**
 * Quanto vai para contas a receber e em quantas parcelas:
 * - carteira (fiado), ou crédito com "gerar contas a receber": o total, em `installments`;
 * - pagamento misto com parte na carteira: só essa parte, em `splitFiadoInstallments`;
 * - qualquer outro caso: nada (null).
 */
export function carteiraBase(i: CarteiraInput): { amount: number; parts: number } | null {
  const isFiado = !i.splitMode && i.paymentMethod === "fiado";
  const isCredit = !i.splitMode && i.paymentMethod === "credito";
  if (isFiado || (isCredit && i.generateReceivables)) {
    return { amount: i.total, parts: Math.max(1, i.installments) };
  }
  const splitFiado = i.splitMode ? i.splits.filter((s) => s.method === "fiado").reduce((a, b) => a + b.amount, 0) : 0;
  if (splitFiado > 0) return { amount: splitFiado, parts: Math.max(1, i.splitFiadoInstallments) };
  return null;
}

/** Divide em partes iguais; a última absorve os centavos para a soma bater exatamente. */
export function splitEvenly(amount: number, parts: number): number[] {
  const each = round2(amount / parts);
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? round2(amount - each * (parts - 1)) : each));
}

/**
 * Valores das parcelas: os digitados pelo operador (quando está ajustando e a
 * quantidade confere) ou a divisão igual. Aceita "1.234,56".
 */
export function installmentAmounts(
  base: { amount: number; parts: number } | null,
  manual: string[],
  isAdjusting: boolean,
): number[] {
  if (!base) return [];
  if (isAdjusting && manual.length === base.parts) return manual.map((v) => parseAmount(v));
  return splitEvenly(base.amount, base.parts);
}

/** Diferença entre o que deve ir para a carteira e a soma das parcelas (0 = confere). */
export function installmentsDiff(base: { amount: number } | null, amounts: number[]): number {
  return round2((base?.amount ?? 0) - amounts.reduce((s, x) => s + x, 0));
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Vencimentos a partir do primeiro (AAAA-MM-DD).
 * Mensal: mesmo dia nos meses seguintes; se o dia não existe no mês, usa o
 * último dia. Antes, 30/01 + 1 mês virava 02/03 (Date.setMonth transborda) e
 * a parcela de fevereiro caía em março.
 * Quinzenal: de 15 em 15 dias.
 */
export function dueDates(first: string, count: number, freq: PaymentFrequency): string[] {
  const [y, m, d] = first.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    if (freq === "quinzenal") {
      const dt = new Date(Date.UTC(y, m - 1, d + i * 15));
      return iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    }
    const month = m - 1 + i;
    const yy = y + Math.floor(month / 12);
    const mm = ((month % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return iso(yy, mm, Math.min(d, lastDay));
  });
}
