import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtBRL } from "@/lib/utils";

interface Props {
  isAdjusting: boolean;
  manual: string[];
  /** Valores atuais das parcelas (divisão igual ou os digitados). */
  amounts: number[];
  /** Vencimentos das parcelas, AAAA-MM-DD. */
  dues: string[];
  diff: number;
  totalLabel: string;
  totalAmount: number;
  onToggleAdjust: () => void;
  onChangeManual: (next: string[]) => void;
}

const br = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
};

/**
 * Ajuste manual dos valores das parcelas + prévia dos vencimentos.
 * Era um bloco repetido no PDV: uma cópia para a carteira e outra para a parte
 * na carteira do pagamento misto.
 */
export function InstallmentsEditor({
  isAdjusting, manual, amounts, dues, diff, totalLabel, totalAmount, onToggleAdjust, onChangeManual,
}: Props) {
  return (
    <>
      <div>
        <Button type="button" variant="outline" size="sm" className="text-xs rounded-lg h-7" onClick={onToggleAdjust}>
          {isAdjusting ? "Cancelar ajuste manual" : "Ajustar valores (Arredondar)"}
        </Button>
      </div>

      {isAdjusting && (
        <div className="space-y-2 pt-2 border-t border-border">
          {manual.map((val, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground w-16">{idx + 1}ª Parcela:</span>
              <div className="flex-1 relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                <Input
                  type="number"
                  step="0.01"
                  className="h-7 pl-7 text-xs glass-input"
                  value={val}
                  onChange={(e) => {
                    const next = [...manual];
                    next[idx] = e.target.value;
                    onChangeManual(next);
                  }}
                />
              </div>
            </div>
          ))}
          <div className="flex justify-between items-center text-xs font-medium pt-1">
            <span>{totalLabel}: {fmtBRL(totalAmount)}</span>
            <span className={Math.abs(diff) > 0.01 ? "text-destructive" : "text-emerald-500"}>
              Dif: {fmtBRL(diff)}
            </span>
          </div>
        </div>
      )}

      {dues.length > 1 && (
        <div className="text-[11px] text-muted-foreground" data-testid="previa-vencimentos">
          Vencimentos:{" "}
          {dues.map((d, i) => `${br(d)} (${fmtBRL(amounts[i] ?? 0)})`).join(" · ")}
        </div>
      )}
    </>
  );
}
