import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { fmtBRL } from "@/lib/utils";
import type { PaymentMethod, SplitEntry } from "./types";

/**
 * Pagamento misto: várias formas na mesma venda.
 *
 * `total` entra como parâmetro porque o restante a distribuir depende do total
 * já com desconto, que vive no useCart.
 */
export function usePaymentSplit(total: number) {
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitEntry[]>([]);
  const [splitMethod, setSplitMethod] = useState<PaymentMethod>("pix");
  const [splitAmount, setSplitAmount] = useState<string>("");
  const [splitFiadoInstallments, setSplitFiadoInstallments] = useState<number>(1);

  const splitsTotal = useMemo(
    () => splits.reduce((s, x) => s + (Number(x.amount) || 0), 0),
    [splits],
  );

  const splitsRemaining = Math.round((total - splitsTotal) * 100) / 100;

  /** Parte da venda que vai para a carteira (fiado) no modo misto. */
  const fiadoAmount = useMemo(
    () => splits.filter((s) => s.method === "fiado").reduce((a, b) => a + b.amount, 0),
    [splits],
  );

  const addSplit = useCallback(() => {
    const amt = Number(String(splitAmount).replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Valor inválido");
      return;
    }
    // Tolerância de meio centavo: o restante vem de arredondamento.
    if (amt - splitsRemaining > 0.009) {
      toast.error(`Valor excede o restante (${fmtBRL(splitsRemaining)})`);
      return;
    }
    setSplits((s) => [...s, { method: splitMethod, amount: Math.round(amt * 100) / 100 }]);
    setSplitAmount("");
  }, [splitAmount, splitMethod, splitsRemaining]);

  const fillRemainingSplit = useCallback(() => {
    if (splitsRemaining <= 0) return;
    setSplitAmount(splitsRemaining.toFixed(2));
  }, [splitsRemaining]);

  const removeSplit = useCallback(
    (idx: number) => setSplits((prev) => prev.filter((_, i) => i !== idx)),
    [],
  );

  const reset = useCallback(() => {
    setSplitMode(false);
    setSplits([]);
    setSplitMethod("pix");
    setSplitAmount("");
    setSplitFiadoInstallments(1);
  }, []);

  return {
    splitMode,
    setSplitMode,
    splits,
    setSplits,
    splitMethod,
    setSplitMethod,
    splitAmount,
    setSplitAmount,
    splitFiadoInstallments,
    setSplitFiadoInstallments,
    splitsTotal,
    splitsRemaining,
    fiadoAmount,
    addSplit,
    fillRemainingSplit,
    removeSplit,
    reset,
  };
}
