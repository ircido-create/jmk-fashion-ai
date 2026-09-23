import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { exportReceivablePdf } from "@/lib/financePdf";
import type { Receivable } from "./types";

type Period = "todos" | "1m" | "1a" | "custom";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Títulos já filtrados pela tela (filtro + busca). */
  rows: Receivable[];
  filterLabel: string;
}

/** Relatório em PDF dos títulos filtrados, com recorte por período de vencimento. */
export default function ReceivableReportDialog({ open, onOpenChange, rows, filterLabel }: Props) {
  const [reportPeriod, setReportPeriod] = useState<Period>("todos");
  const [reportFrom, setReportFrom] = useState<string>("");
  const [reportTo, setReportTo] = useState<string>("");

  // Cada abertura volta para "Todos" (antes o botão da página fazia isso).
  useEffect(() => {
    if (open) setReportPeriod("todos");
  }, [open]);

  const runReport = () => {
    let from: Date | null = null;
    const to = new Date();
    if (reportPeriod === "1m") { from = new Date(); from.setMonth(from.getMonth() - 1); }
    else if (reportPeriod === "1a") { from = new Date(); from.setFullYear(from.getFullYear() - 1); }
    else if (reportPeriod === "custom") {
      if (!reportFrom || !reportTo) { toast.error("Informe o período"); return; }
      from = new Date(reportFrom + "T00:00:00");
    }
    const toIso = reportPeriod === "custom" ? reportTo : to.toISOString().slice(0, 10);
    const fromIso = from ? from.toISOString().slice(0, 10) : null;

    const selected = rows.filter((r) => {
      if (!fromIso) return true;
      return r.due_date >= fromIso && r.due_date <= toIso;
    });
    if (selected.length === 0) { toast.error("Nenhum lançamento no período selecionado"); return; }

    const labelMap: Record<Period, string> = {
      todos: "todos os períodos",
      "1m": "último mês",
      "1a": "último ano",
      custom: `${reportFrom} a ${reportTo}`,
    };
    exportReceivablePdf(selected, `${filterLabel} • ${labelMap[reportPeriod]}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border">
        <DialogHeader><DialogTitle>Gerar relatório</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Filtro atual: <strong>{filterLabel}</strong> ({rows.length} título(s))
          </div>
          <div>
            <Label>Período</Label>
            <Select value={reportPeriod} onValueChange={(v) => setReportPeriod(v as Period)}>
              <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="1m">Último mês</SelectItem>
                <SelectItem value="1a">Último ano</SelectItem>
                <SelectItem value="custom">Período personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {reportPeriod === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>De</Label>
                <Input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="glass-input" />
              </div>
              <div>
                <Label>Até</Label>
                <Input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="glass-input" />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={runReport} className="bg-gradient-primary text-primary-foreground">
            <FileDown className="h-4 w-4 mr-1" /> Gerar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
