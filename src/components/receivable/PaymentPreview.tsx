import { format, parseISO } from "date-fns";
import { fmtBRL } from "@/lib/utils";
import type { ManualPaymentResult } from "@/lib/reconcile";

/** Mostra, antes de confirmar, quais parcelas a baixa vai quitar ou reduzir (sempre das mais antigas). */
export default function PaymentPreview({ result }: { result: ManualPaymentResult | null }) {
  if (!result || result.actions.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/50 p-2 text-xs space-y-1">
      <div className="font-medium">O que será feito (das parcelas mais antigas para as mais novas)</div>
      {result.actions.map((a) => (
        <div key={a.receivable_id} className="flex justify-between gap-3 text-muted-foreground">
          <span>
            Venc. {format(parseISO(a.due_date), "dd/MM/yyyy")} —{" "}
            {a.kind === "settle" ? "quitada" : `reduzida para ${fmtBRL(a.new_amount ?? 0)}`}
          </span>
          <span className="font-medium text-foreground">{fmtBRL(a.amount_paid)}</span>
        </div>
      ))}
      {result.leftovers[0] && (
        <div className="text-amber-600 dark:text-amber-400">
          Sobra sem parcela: {fmtBRL(result.leftovers[0].amount)}
        </div>
      )}
    </div>
  );
}
