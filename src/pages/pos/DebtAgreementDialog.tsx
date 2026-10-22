import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmtBRL } from "@/lib/utils";

interface Props {
  open: boolean;
  customerName: string;
  /** Soma das parcelas em aberto da cliente, antes desta compra. */
  debt: number;
  saleTotal: number;
  /** Junta tudo: as parcelas antigas são encerradas e o saldo entra no novo parcelamento. */
  onMerge: () => void;
  /** Deixa a dívida antiga como está e parcela só esta compra. */
  onKeep: () => void;
}

/**
 * Perguntado na hora de fechar a venda quando a cliente já deve e a compra vai
 * para a carteira. Sem isso o operador fechava a venda e só depois descobria
 * que a cliente tinha ficado com dois parcelamentos correndo juntos.
 */
export function DebtAgreementDialog({ open, customerName, debt, saleTotal, onMerge, onKeep }: Props) {
  const novoTotal = debt + saleTotal;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onKeep(); }}>
      <DialogContent className="glass-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle>Cliente tem dívida em aberto</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">{customerName}</span> já tem parcelas em
            aberto. Deseja fazer um novo acordo, juntando a dívida a esta compra?
          </p>
          <div className="rounded-xl bg-white/40 dark:bg-white/5 p-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dívida atual:</span>
              <span className="font-semibold text-destructive">{fmtBRL(debt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Compra de agora:</span>
              <span className="font-medium">{fmtBRL(saleTotal)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1">
              <span className="text-muted-foreground">Novo acordo:</span>
              <span className="font-bold text-primary">{fmtBRL(novoTotal)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            No acordo, as parcelas antigas são encerradas e tudo volta parcelado do zero. Você ainda
            escolhe a quantidade de parcelas e o vencimento antes de finalizar.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onKeep} className="rounded-xl">
            Manter separado
          </Button>
          <Button onClick={onMerge} className="rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            Somar e refazer parcelas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
