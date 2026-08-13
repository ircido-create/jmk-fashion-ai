import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna o valor total da dívida em aberto (contas a receber pendentes/vencidas)
 * e o crédito do cliente (soma do que foi pago a mais em cada parcela).
 */
export function useCustomerDebt(customerId: string | null | undefined) {
  const [debt, setDebt] = useState<number | null>(0);
  const [credit, setCredit] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId) {
      setDebt(null);
      setCredit(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("accounts_receivable")
        .select("amount, status, receivable_payments(amount_paid)")
        .eq("customer_id", customerId);
      if (cancelled) return;
      if (error) {
        setDebt(0);
        setCredit(0);
      } else {
        let open = 0;
        let over = 0;
        for (const r of (data ?? []) as any[]) {
          const paid = (r.receivable_payments ?? []).reduce(
            (s: number, p: any) => s + Number(p.amount_paid || 0),
            0,
          );
          const amount = Number(r.amount || 0);
          if (r.status === "pendente" || r.status === "vencido") {
            open += Math.max(0, amount - paid);
          }
          if (r.status !== "cancelado") {
            over += Math.max(0, paid - amount);
          }
        }
        setDebt(open);
        setCredit(over);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return { debt, credit, loading };
}

export const fmtBRL = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
