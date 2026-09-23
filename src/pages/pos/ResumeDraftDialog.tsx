import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmtBRL } from "@/lib/utils";
import type { SaleDraft } from "./saleDraft";

interface Props {
  draft: SaleDraft | null;
  onResume: () => void;
  onDiscard: () => void;
  /** Fechar no X apenas adia: o rascunho continua guardado para a próxima abertura. */
  onPostpone: () => void;
}

/** Oferece retomar a venda que ficou aberta. */
export function ResumeDraftDialog({ draft, onResume, onDiscard, onPostpone }: Props) {
  return (
    <Dialog open={!!draft} onOpenChange={(o) => { if (!o) onPostpone(); }}>
      <DialogContent className="glass-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle>Retomar venda em andamento?</DialogTitle>
        </DialogHeader>
        {draft && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Uma venda ficou aberta em {new Date(draft.savedAt).toLocaleString("pt-BR")}.
            </p>
            <div className="rounded-xl bg-white/40 dark:bg-white/5 p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cliente:</span>
                <span className="font-medium">{draft.selectedCustomer?.name ?? "não informado"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Itens:</span>
                <span className="font-medium">
                  {draft.cart.reduce((n, i) => n + i.quantity, 0)} peça(s)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-semibold">
                  {fmtBRL(draft.cart.reduce((v, i) => v + i.unitPrice * i.quantity, 0))}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              O estoque é conferido de novo na hora de finalizar.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDiscard} className="rounded-xl">
            Descartar
          </Button>
          <Button onClick={onResume} className="rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            Retomar venda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
