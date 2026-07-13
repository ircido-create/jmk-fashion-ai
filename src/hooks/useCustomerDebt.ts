import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna o valor total da dívida em aberto (contas a receber pendentes/parciais)
 * do cliente informado. Retorna null enquanto carrega.
 */
export function useCustomerDebt(customerId: string | null | undefined) {
  const [debt, setDebt] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId) {
      setDebt(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("accounts_receivable")
        .select("amount, status, receivable_payments(amount_paid)")
        .eq("customer_id", customerId)
        .in("status", ["pendente", "vencido"]);
      if (cancelled) return;
      if (error) {
        setDebt(0);
      } else {
        const total = (data ?? []).reduce((sum: number, r: any) => {
          const paid = (r.receivable_payments ?? []).reduce(
            (s: number, p: any) => s + Number(p.amount_paid || 0),
            0,
          );
          const open = Math.max(0, Number(r.amount || 0) - paid);
          return sum + open;
        }, 0);
        setDebt(total);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return { debt, loading };
}

export const fmtBRL = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
