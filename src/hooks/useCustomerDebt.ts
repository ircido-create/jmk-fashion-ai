import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna o valor total da dívida em aberto (contas a receber pendentes/vencidas).
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
        .select("amount, status")
        .eq("customer_id", customerId)
        .in("status", ["pendente", "vencido"]);
      if (cancelled) return;
      if (error) {
        setDebt(0);
      } else {
        const open = (data ?? []).reduce(
          (s: number, r: any) => s + Number(r.amount || 0),
          0,
        );
        setDebt(open);
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
