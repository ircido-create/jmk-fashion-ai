import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { fmtBRL } from "@/lib/utils";
import { PAYMENT_LABELS, type ReceiptData } from "./types";

interface Props {
  open: boolean;
  receipt: ReceiptData | null;
  /** Fecha o cupom e limpa a venda para começar a próxima. */
  onClose: () => void;
}

/**
 * Pré-visualização e impressão do cupom não-fiscal.
 *
 * A ref de impressão vive aqui, junto do markup que ela copia — antes ficava em
 * POS.tsx, a mil linhas de distância do elemento que referenciava.
 */
export function ReceiptDialog({ open, receipt, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const printReceipt = () => {
    if (!printRef.current) return;
    const html = printRef.current.innerHTML;
    const w = window.open("", "_blank", "width=380,height=600");
    if (!w) {
      toast.error("Bloqueador de pop-up impediu a impressão");
      return;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cupom ${receipt?.number}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0; color: #000; }
        h1,h2,h3,p { margin: 0; }
        .center { text-align: center; }
        .right { text-align: right; }
        .row { display: flex; justify-content: space-between; gap: 6px; }
        .sep { border-top: 1px dashed #000; margin: 6px 0; }
        .bold { font-weight: bold; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 2px 0; vertical-align: top; }
      </style></head><body>${html}
      <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); }${"<"}/script>
      </body></html>`);
    w.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cupom — Pré-visualização</DialogTitle>
        </DialogHeader>
        {receipt && (
          <div ref={printRef} className="font-mono text-xs leading-tight bg-white text-black p-4 rounded">
            <div className="center">
              <div className="bold" style={{ fontSize: 14 }}>JMK MODA</div>
              <div>Cupom Não-Fiscal</div>
              <div>Nº {receipt.number}</div>
              <div>{receipt.date.toLocaleString("pt-BR")}</div>
            </div>
            <div className="sep" />
            {receipt.customer && (
              <>
                <div>Cliente: {receipt.customer.name}</div>
                {receipt.customer.phone && <div>Tel: {receipt.customer.phone}</div>}
                <div className="sep" />
              </>
            )}
            <table>
              <tbody>
                {receipt.items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      {it.productName}
                      {it.variantLabel ? ` (${it.variantLabel})` : ""}
                      <br />
                      {it.quantity} x {fmtBRL(it.unitPrice)}
                    </td>
                    <td className="right">{fmtBRL(it.unitPrice * it.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sep" />
            {(receipt.discount ?? 0) > 0 && (
              <>
                <div className="row">
                  <span>Subtotal</span>
                  <span>{fmtBRL(receipt.grossSubtotal ?? receipt.subtotal)}</span>
                </div>
                <div className="row">
                  <span>Desconto</span>
                  <span>- {fmtBRL(receipt.discount ?? 0)}</span>
                </div>
              </>
            )}
            <div className="row bold" style={{ fontSize: 13 }}>
              <span>TOTAL</span>
              <span>{fmtBRL(receipt.subtotal)}</span>
            </div>
            <div className="sep" />
            <div>Pagamento: {PAYMENT_LABELS[receipt.payment] ?? receipt.payment}</div>
            {receipt.splits && receipt.splits.length > 0 && (
              <>
                {receipt.splits.map((s, i) => (
                  <div key={i} className="row">
                    <span>· {PAYMENT_LABELS[s.method]}:</span>
                    <span>{fmtBRL(s.amount)}</span>
                  </div>
                ))}
              </>
            )}
            {receipt.payment === "credito" && receipt.installments > 1 && (
              <div>
                {receipt.installments}x de {fmtBRL(receipt.subtotal / receipt.installments)}
              </div>
            )}
            {receipt.payment === "dinheiro" && receipt.cashReceived > 0 && (
              <>
                <div className="row">
                  <span>Recebido:</span>
                  <span>{fmtBRL(receipt.cashReceived)}</span>
                </div>
                <div className="row">
                  <span>Troco:</span>
                  <span>{fmtBRL(receipt.change)}</span>
                </div>
              </>
            )}
            {receipt.payment === "fiado" && (
              <>
                {receipt.installments > 1 && (
                  <div>
                    {receipt.installments}x de {fmtBRL(receipt.subtotal / receipt.installments)}
                  </div>
                )}
                <div>Lançado na carteira do cliente.</div>
              </>
            )}
            <div className="sep" />
            <div className="center">Obrigado pela preferência!</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={printReceipt} className="bg-gradient-primary text-primary-foreground">
            <Printer className="h-4 w-4 mr-1" /> Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
