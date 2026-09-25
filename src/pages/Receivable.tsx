import { useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, CheckCircle2, FileDown, Paperclip, CheckSquare, Upload } from "lucide-react";
import { usePagination } from "@/hooks/usePagination";
import { toast } from "sonner";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { digitsOnly } from "@/lib/taxId";
import { reconcileManualPayment, type ReceivableLite } from "@/lib/reconcile";
import { applyReceivablePayment, prepareProof } from "@/lib/applyPayment";
import type { Customer, Receivable } from "@/components/receivable/types";
import BulkReconcileDialog from "@/components/receivable/BulkReconcileDialog";
import ImportReceivablesDialog from "@/components/receivable/ImportReceivablesDialog";
import ReceivableReportDialog from "@/components/receivable/ReceivableReportDialog";
import PaymentPreview from "@/components/receivable/PaymentPreview";

const schema = z.object({
  customer_id: z.string().uuid().nullable(),
  description: z.string().trim().max(200).optional().or(z.literal("")),
  amount: z.number().positive(),
  due_date: z.string().min(1),
});

const statusColor: Record<string, string> = {
  pendente: "bg-blue-500/15 text-blue-700",
  pago: "bg-success/15 text-success",
  vencido: "bg-destructive/15 text-destructive",
  cancelado: "bg-muted text-muted-foreground",
};

export default function Receivable() {
  const [list, setList] = useState<Receivable[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Receivable | null>(null);
  const [filter, setFilter] = useState<string>("a_receber");
  const [search, setSearch] = useState("");

  // Baixa individual
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<Receivable | null>(null);
  const [payAmount, setPayAmount] = useState<string>("");
  const [payFile, setPayFile] = useState<File | null>(null);
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [paySaving, setPaySaving] = useState(false);

  // Diálogos com estado próprio (components/receivable)
  const [bulkOpen, setBulkOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    try {
      const data = await fetchAll<any>((sb) =>
        sb.from("accounts_receivable")
          .select("*, customers(name, nickname, tax_id, phone)")
          .order("due_date", { ascending: true })
      );
      const today = new Date().toISOString().slice(0, 10);
      const items: Receivable[] = data.map((r: any) => ({
        ...r,
        status: r.status === "pendente" && r.due_date < today ? "vencido" : r.status,
      }));

      // Buscar comprovantes vinculados
      const ids = items.map((i) => i.id);
      if (ids.length > 0) {
        const { data: rp } = await supabase
          .from("receivable_payments")
          .select("receivable_id, proof_id, amount_paid, payment_proofs(original_filename, storage_path, payment_date)")
          .in("receivable_id", ids);
        const map = new Map<string, Receivable["proofs"]>();
        const paidByReceivable = new Map<string, number>();
        (rp ?? []).forEach((row: any) => {
          const arr = map.get(row.receivable_id) ?? [];
          arr!.push({
            proof_id: row.proof_id,
            original_filename: row.payment_proofs?.original_filename ?? null,
            storage_path: row.payment_proofs?.storage_path ?? "",
            payment_date: row.payment_proofs?.payment_date ?? null,
          });
          map.set(row.receivable_id, arr);
          paidByReceivable.set(
            row.receivable_id,
            (paidByReceivable.get(row.receivable_id) ?? 0) + Number(row.amount_paid || 0)
          );
        });
        items.forEach((i) => { i.proofs = map.get(i.id) ?? []; });
      }
      setList(items);

      const cs = await fetchAll<Customer>((sb) =>
        sb.from("customers").select("id, name, nickname, tax_id, phone").order("name")
      );
      setCustomers(cs);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cid = f.get("customer_id") as string;
    if (!cid || cid === "none") { toast.error("Selecione o cliente"); return; }
    const parsed = schema.safeParse({
      customer_id: cid,
      description: f.get("description"),
      amount: Number(f.get("amount")),
      due_date: f.get("due_date"),
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    const todayIso = new Date().toISOString().slice(0, 10);
    const payload: any = {
      customer_id: parsed.data.customer_id,
      description: parsed.data.description || null,
      amount: parsed.data.amount,
      due_date: parsed.data.due_date,
    };
    // Recalcula status ao alterar a data (somente para parcelas não pagas)
    if (!editing || (editing.status !== "pago" && editing.status !== "cancelado")) {
      payload.status = parsed.data.due_date < todayIso ? "vencido" : "pendente";
    }
    const { error } = editing
      ? await supabase.from("accounts_receivable").update(payload).eq("id", editing.id)
      : await supabase.from("accounts_receivable").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Salvo"); setOpen(false); setEditing(null); load();
  };

  const openPay = (r: Receivable) => {
    setPayTarget(r);
    setPayAmount(String(r.amount));
    setPayFile(null);
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayOpen(true);
  };

  // A baixa vai sempre para as parcelas mais antigas da cliente, mesmo que a
  // clicada seja outra — o quadro "O que será feito" mostra quais.
  const payPreview = useMemo(() => {
    const amt = Number(payAmount);
    if (!payOpen || !payTarget || !(amt > 0)) return null;
    const customerReceivables = list.filter((r) =>
      payTarget.customer_id
        ? r.customer_id === payTarget.customer_id
        : r.id === payTarget.id
    );
    const lite: ReceivableLite[] = customerReceivables.map((r) => ({
      id: r.id,
      customer_id: r.customer_id,
      customer_name: r.customers?.name ?? payTarget.customers?.name ?? "",
      amount: Number(r.amount),
      due_date: r.due_date,
      status: r.status,
    }));
    return reconcileManualPayment(lite, amt);
  }, [payOpen, payTarget, payAmount, list]);

  const confirmPay = async () => {
    if (!payTarget) return;
    setPaySaving(true);
    try {
      const amt = Number(payAmount);
      if (!(amt > 0)) throw new Error("Valor inválido");
      if (!payDate) throw new Error("Informe a data do recebimento");
      const paidAtIso = new Date(`${payDate}T12:00:00`).toISOString();

      const result = payPreview;
      if (!result || result.actions.length === 0) throw new Error("Nenhuma parcela pendente para baixar");

      const proof = await prepareProof(payFile, `Baixa de ${payTarget.customers?.name ?? "—"}`, payTarget.customer_id);
      await applyReceivablePayment({ actions: result.actions, paidAtIso, proof });

      const leftoverMsg = result.leftovers.length > 0 ? ` • sobra R$ ${result.leftovers[0].amount.toFixed(2)}` : "";
      toast.success(
        `Recebimento aplicado: ${result.totals.fullySettled} quitada(s) + ${result.totals.partiallyReduced} reduzida(s)${leftoverMsg}`
      );
      setFilter("pago");
      setPayOpen(false); setPayTarget(null); setPayFile(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPaySaving(false);
    }
  };

  const remove = async (receivable: Receivable) => {
    if ((receivable.proofs?.length ?? 0) > 0) {
      toast.error("Esta parcela possui pagamento. Exclua o comprovante para estornar o valor corretamente.");
      return;
    }
    if (!confirm("Excluir?")) return;
    const { error } = await supabase.from("accounts_receivable").delete().eq("id", receivable.id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); load(); }
  };

  const openProof = async (storage_path: string) => {
    if (!storage_path) { toast.error("Comprovante sem arquivo"); return; }
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(storage_path, 60 * 5);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank");
  };

  const debouncedSearch = useDebouncedValue(search, 300);
  const filtered = (() => {
    const base = (() => {
      switch (filter) {
        case "todos": return list;
        case "a_receber": return list.filter((r) => r.status === "pendente" || r.status === "vencido");
        case "a_vencer": return list.filter((r) => r.status === "pendente");
        case "vencido": return list.filter((r) => r.status === "vencido");
        case "pago": return list.filter((r) => r.status === "pago");
        
        default: return list;
      }
    })();
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return base;
    const qDigits = digitsOnly(q);
    return base.filter((r) => {
      const c = r.customers;
      return (
        (c?.name ?? "").toLowerCase().includes(q) ||
        (c?.nickname ?? "").toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (qDigits.length > 0 && (
          digitsOnly(c?.phone ?? "").includes(qDigits) ||
          digitsOnly(c?.tax_id ?? "").includes(qDigits)
        ))
      );
    });
  })();
  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);

  const sum = (arr: Receivable[]) => arr.reduce((s, r) => s + Number(r.amount), 0);
  const aReceberAll = list.filter((r) => r.status === "pendente" || r.status === "vencido");
  const vencidoAll = list.filter((r) => r.status === "vencido");
  const pagoAll = list.filter((r) => r.status === "pago");

  const { paged, Controls } = usePagination(filtered, 20);

  const filterLabels: Record<string, string> = {
    todos: "Todos",
    a_receber: "A Receber",
    a_vencer: "A Vencer",
    vencido: "Vencido",
    pago: "Pago",
    
  };


  return (
    <div>
      <PageHeader
        title="Contas a Receber"
        description={`${filterLabels[filter]}: R$ ${total.toFixed(2)} • ${filtered.length} título(s)`}
        actions={
          <>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setReportOpen(true)}
            >
              <FileDown className="h-4 w-4 mr-1" /> Relatório
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4 mr-1" /> Importar
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setBulkOpen(true)}
              title="Conciliar extrato com contas a receber"
            >
              <CheckSquare className="h-4 w-4 mr-1" /> Baixa em massa
            </Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-primary text-primary-foreground shadow-glow rounded-xl">
                  <Plus className="h-4 w-4 mr-1" /> Nova
                </Button>
              </DialogTrigger>
              <DialogContent className="glass-card border-border">
                <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} conta a receber</DialogTitle></DialogHeader>
                <form onSubmit={save} className="space-y-3">
                  <div>
                    <Label>Cliente</Label>
                    <Select name="customer_id" defaultValue={editing?.customer_id ?? undefined} required>
                      <SelectTrigger className="glass-input"><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Descrição</Label><Input name="description" defaultValue={editing?.description ?? ""} className="glass-input" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Valor (R$)</Label><Input name="amount" type="number" step="0.01" defaultValue={editing?.amount} required className="glass-input" /></div>
                    <div><Label>Vencimento</Label><Input name="due_date" type="date" defaultValue={editing?.due_date} required className="glass-input" /></div>
                  </div>
                  <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground rounded-xl">Salvar</Button>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="glass-card p-4">
          <div className="text-xs text-muted-foreground">A Receber (total)</div>
          <div className="text-2xl font-bold gradient-text">R$ {sum(aReceberAll).toFixed(2)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{aReceberAll.length} título(s)</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-muted-foreground">↳ Vencido</div>
          <div className="text-2xl font-bold text-destructive">R$ {sum(vencidoAll).toFixed(2)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{vencidoAll.length} título(s)</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-muted-foreground">Recebido</div>
          <div className="text-2xl font-bold text-success">R$ {sum(pagoAll).toFixed(2)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{pagoAll.length} título(s)</div>
        </div>
      </div>

      <GlassCard>
        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            { k: "a_receber", label: "A Receber" },
            { k: "a_vencer", label: "A Vencer" },
            { k: "vencido", label: "Vencido" },
            { k: "pago", label: "Pago" },
            
            { k: "todos", label: "Todos" },
          ].map(({ k, label }) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"}
              onClick={() => setFilter(k)}
              className={filter === k ? "bg-gradient-primary text-primary-foreground" : ""}>
              {label}
            </Button>
          ))}
        </div>

        <div className="relative mb-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, apelido, telefone, CPF/CNPJ ou descrição..."
            className="glass-input"
          />
        </div>

        <div className="space-y-2">
          {paged.map((r) => (
            <div key={r.id} className="p-3 rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-medium ${!r.customer_id ? "text-destructive" : ""}`}>
                    {r.customers?.name ?? "— sem cliente —"}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColor[r.status]}`}>{r.status}</span>
                  {r.proofs && r.proofs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openProof(r.proofs![0].storage_path)}
                      title={r.proofs[0].original_filename ?? "Ver comprovante"}
                      className="inline-flex items-center text-muted-foreground hover:text-primary"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.status === "pago" ? (
                    <>
                      {r.description || "—"} • Venc: {format(parseISO(r.due_date), "dd/MM/yyyy", { locale: ptBR })}
                      {" • "}
                      <span className="text-success">Pago em: {r.paid_at
                        ? format(parseISO(r.paid_at), "dd/MM/yyyy", { locale: ptBR })
                        : r.proofs?.[0]?.payment_date
                        ? format(parseISO(r.proofs[0].payment_date), "dd/MM/yyyy", { locale: ptBR })
                        : "—"}</span>
                    </>
                  ) : (
                    <>{r.description || "—"} • Venc: {format(parseISO(r.due_date), "dd/MM/yyyy", { locale: ptBR })}</>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold">R$ {Number(r.amount).toFixed(2)}</div>
                <div className="flex gap-1 mt-1">
                  {r.status !== "pago" && (
                    <Button size="icon" variant="ghost" onClick={() => openPay(r)} title="Marcar como recebido" aria-label="Marcar como recebido">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(r)} aria-label="Excluir"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">Nada por aqui</div>}
        </div>
        {Controls}
      </GlassCard>

      {/* Modal: baixa individual */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle>Baixa de recebimento</DialogTitle>
          </DialogHeader>
          {payTarget && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {payTarget.customers?.name ?? "—"} • Venc: {format(parseISO(payTarget.due_date), "dd/MM/yyyy", { locale: ptBR })}
              </div>
              <div>
                <Label>Data do recebimento</Label>
                <Input
                  type="date" value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="glass-input"
                />
              </div>
              <div>
                <Label>Valor recebido (R$)</Label>
                <Input
                  type="number" step="0.01" value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="glass-input"
                />
              </div>
              <div>
                <Label>Comprovante (opcional)</Label>
                <Input
                  type="file"
                  onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
                  className="glass-input"
                  accept="image/*,application/pdf,.xlsx,.xls,.csv"
                />
                {payFile && <div className="text-xs text-muted-foreground mt-1">{payFile.name}</div>}
              </div>
              <PaymentPreview result={payPreview} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paySaving}>Cancelar</Button>
            <Button onClick={confirmPay} disabled={paySaving} className="bg-gradient-primary text-primary-foreground">
              {paySaving ? "Salvando..." : "Confirmar baixa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkReconcileDialog open={bulkOpen} onOpenChange={setBulkOpen} list={list} customers={customers} onApplied={load} />
      <ReceivableReportDialog open={reportOpen} onOpenChange={setReportOpen} rows={filtered} filterLabel={filterLabels[filter]} />
      <ImportReceivablesDialog open={importOpen} onOpenChange={setImportOpen} list={list} customers={customers} onImported={load} />
    </div>
  );
}
