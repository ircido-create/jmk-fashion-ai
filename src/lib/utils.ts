import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formata valor em reais. Estava redefinido em 7 arquivos. */
export const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Data do banco em formato brasileiro.
 *
 * Uma data pura ("2026-11-20") é lida pelo JavaScript como meia-noite em UTC;
 * no horário de Brasília isso cai às 21h do dia anterior, e a parcela que vence
 * em 20/11 aparecia como 19/11 na tela. Ancorar ao meio-dia resolve em qualquer
 * fuso. Quando vem data e hora (created_at), o valor já traz o fuso e é usado
 * como está.
 */
export const fmtDate = (s: string | null | undefined): string => {
  if (!s) return "—";
  const puro = /^\d{4}-\d{2}-\d{2}$/.test(s);
  return new Date(puro ? `${s}T12:00:00` : s).toLocaleDateString("pt-BR");
};
