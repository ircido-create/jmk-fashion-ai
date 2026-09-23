import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { digitsOnly } from "@/lib/taxId";
import { reconcile, type PaymentRow, type ReconciliationResult, type ReceivableLite } from "@/lib/reconcile";
import { applyReceivablePayment, prepareProof } from "@/lib/applyPayment";
import { findKey, parseAmount, parseDate, readFirstSheet } from "@/lib/spreadsheet";
import type { Customer, Receivable } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: Receivable[];
  customers: Customer[];
  onApplied: () => void;
}

/** Baixa em massa: lê o extrato, concilia com as parcelas em aberto e aplica tudo numa transação. */
export default function BulkReconcileDialog({ open, onOpenChange, list, customers, onApplied }: Props) {
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkDesc, setBulkDesc] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkResult, setBulkResult] = useState<ReconciliationResult | null>(null);

  // Cada abertura começa do zero (antes o botão da página zerava o estado).
  useEffect(() => {
    if (!open) return;
    setBulkFile(null);
    setBulkDesc("");
    setBulkResult(null);
  }, [open]);

  // Parser de extrato: aceita xlsx/xls/csv com colunas Cliente, Valor (e opcionalmente Data/CPF/CNPJ)
  const parseBulkFile = async (file: File) => {
    setBulkParsing(true);
    setBulkResult(null);
    try {
      const json = await readFirstSheet(file);

      const rows: PaymentRow[] = json.map((row, i) => {
        const kCust = findKey(row, ["razao social", "razão social", "cliente", "customer", "nome", "sacado", "pagador", "favorecido", "historico"]);
        const kTax = findKey(row, ["cpf/cnpj", "cpf", "cnpj", "documento"]);
        const kAmt = findKey(row, ["valor (r$)", "valor", "amount", "credito", "crédito", "valor pago"]);
        const kDate = findKey(row, ["data", "data pagamento", "data credito", "data crédito", "payment_date"]);
        const kDesc = findKey(row, ["descricao", "description", "memo", "obs"]);
        return {
          customer_name: kCust ? String(row[kCust]).trim() : "",
          tax_id: kTax ? digitsOnly(String(row[kTax])) : "",
          amount: kAmt ? parseAmount(row[kAmt]) : 0,
          payment_date: kDate ? parseDate(row[kDate]) : new Date().toISOString().slice(0, 10),
          description: kDesc ? String(row[kDesc]).trim() : "",
          line: i + 2,
        };
      }).filter((r) => r.amount > 0 && r.customer_name);

      if (rows.length === 0) {
        toast.error("Nenhuma linha de pagamento encontrada (precisa de Cliente + Valor).");
        return;
      }

      // Constrói lista de receivables com nome de cliente + tax_id resolvido
      const customerById = new Map(customers.map((c) => [c.id, c]));
      const lite: ReceivableLite[] = list.map((r) => {
        const c = r.customer_id ? customerById.get(r.customer_id) : null;
        return {
          id: r.id,
          customer_id: r.customer_id,
          customer_name: c?.name ?? r.customers?.name ?? "",
          customer_nickname: c?.nickname ?? null,
          customer_tax_id: c?.tax_id ?? null,
          amount: Number(r.amount),
          due_date: r.due_date,
          status: r.status,
        };
      });

      const result = reconcile(lite, rows);
      setBulkResult(result);

      const t = result.totals;
      toast.success(
        `${rows.length} pagamento(s) lido(s) • ${t.fullySettled} quitação(ões) integral(is) • ${t.partiallyReduced} parcial(is) • ${t.unmatched} sem cliente`
      );
    } catch (e: any) {
      toast.error(e.message || "Erro ao ler o extrato");
    } finally {
      setBulkParsing(false);
    }
  };

  const confirmBulk = async () => {
    if (!bulkResult || bulkResult.actions.length === 0) {
      toast.error("Nenhuma baixa para aplicar");
      return;
    }
    setBulkSaving(true);
    try {
      const proof = await prepareProof(
        bulkFile,
        bulkDesc || `Conciliação em massa — ${format(new Date(), "dd/MM/yyyy")}`,
        null,
      );
      // Tudo ou nada: se uma parcela do extrato mudou desde a leitura, nenhuma é baixada.
      await applyReceivablePayment({ actions: bulkResult.actions, paidAtIso: new Date().toISOString(), proof });

      const t = bulkResult.totals;
      toast.success(
        `Conciliação aplicada: ${t.fullySettled} quitada(s) + ${t.partiallyReduced} parcial(is) • R$ ${t.paidSum.toFixed(2)}`
      );
      onOpenChange(false);
      onApplied();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border max-w-3xl">
        <DialogHeader>
          <DialogTitle>Baixa em massa — conciliação por extrato</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Anexe um extrato (<strong>.xlsx</strong>, <strong>.xls</strong> ou <strong>.csv</strong>) com colunas
            <strong> Cliente</strong> e <strong>Valor</strong> (e opcionalmente <strong>CPF/CNPJ</strong>, <strong>Data</strong>).
            O sistema soma os pagamentos por cliente e abate as parcelas pendentes da{" "}
            <strong>mais antiga primeiro</strong>. Se sobrar valor que não cubra a próxima parcela inteira, o valor da
            parcela é reduzido (e ela permanece em aberto).
          </div>

          <div>
            <Label>Extrato</Label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={bulkParsing}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setBulkFile(f);
                setBulkResult(null);
                if (f) parseBulkFile(f);
              }}
              className="glass-input"
            />
            {bulkFile && <div className="text-xs text-muted-foreground mt-1">{bulkFile.name}</div>}
            {bulkParsing && <div className="text-xs text-primary mt-1">Lendo extrato e conciliando...</div>}
          </div>

          <div>
            <Label>Descrição (opcional)</Label>
            <Input
              value={bulkDesc}
              onChange={(e) => setBulkDesc(e.target.value)}
              placeholder={`Conciliação — ${format(new Date(), "dd/MM/yyyy")}`}
              className="glass-input"
            />
          </div>

          {bulkResult && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg bg-white/40 dark:bg-white/5 p-2">
                  <div className="text-muted-foreground">Pagamentos lidos</div>
                  <div className="font-semibold">{bulkResult.totals.payments}</div>
                  <div className="text-[11px] text-muted-foreground">R$ {bulkResult.totals.paymentsSum.toFixed(2)}</div>
                </div>
                <div className="rounded-lg bg-success/10 p-2">
                  <div className="text-muted-foreground">Quitações integrais</div>
                  <div className="font-semibold text-success">{bulkResult.totals.fullySettled}</div>
                </div>
                <div className="rounded-lg bg-amber-500/10 p-2">
                  <div className="text-muted-foreground">Parciais (parcela reduzida)</div>
                  <div className="font-semibold text-amber-700">{bulkResult.totals.partiallyReduced}</div>
                </div>
                <div className="rounded-lg bg-destructive/10 p-2">
                  <div className="text-muted-foreground">Sem cliente / sobra</div>
                  <div className="font-semibold text-destructive">
                    {bulkResult.totals.unmatched + bulkResult.leftovers.length}
                  </div>
                </div>
              </div>

              {bulkResult.actions.length > 0 && (
                <div className="max-h-64 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th scope="col" className="text-left p-2">Cliente</th>
                        <th scope="col" className="text-left p-2">Vencimento</th>
                        <th scope="col" className="text-right p-2">Original</th>
                        <th scope="col" className="text-right p-2">Recebido</th>
                        <th scope="col" className="text-left p-2">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResult.actions.slice(0, 200).map((a, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="p-2">{a.customer_name || "—"}</td>
                          <td className="p-2">{format(parseISO(a.due_date), "dd/MM/yyyy")}</td>
                          <td className="p-2 text-right">R$ {a.original_amount.toFixed(2)}</td>
                          <td className="p-2 text-right font-medium">R$ {a.amount_paid.toFixed(2)}</td>
                          <td className="p-2">
                            {a.kind === "settle" ? (
                              <span className="text-success">Quitado</span>
                            ) : (
                              <span className="text-amber-700">
                                Parcial → restará R$ {(a.new_amount ?? 0).toFixed(2)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(bulkResult.unmatchedPayments.length > 0 || bulkResult.leftovers.length > 0) && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs">
                  <div className="font-medium text-destructive mb-1">Não conciliados</div>
                  <ul className="space-y-1 max-h-32 overflow-auto">
                    {bulkResult.unmatchedPayments.slice(0, 50).map((u, i) => (
                      <li key={`u${i}`}>
                        • {u.payment.customer_name || "—"} • R$ {u.payment.amount.toFixed(2)}{" "}
                        <span className="text-muted-foreground">({u.reason})</span>
                      </li>
                    ))}
                    {bulkResult.leftovers.slice(0, 50).map((l, i) => (
                      <li key={`l${i}`}>
                        • {l.customer_name} • sobra de R$ {l.amount.toFixed(2)} (sem mais parcelas pendentes)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bulkSaving}>Cancelar</Button>
          <Button
            onClick={confirmBulk}
            disabled={bulkSaving || !bulkResult || bulkResult.actions.length === 0}
            className="bg-gradient-primary text-primary-foreground"
          >
            {bulkSaving
              ? "Aplicando..."
              : bulkResult
              ? `Aplicar baixa (${bulkResult.actions.length})`
              : "Anexe o extrato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
