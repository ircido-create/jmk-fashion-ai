import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, CheckCircle2, FileDown, Paperclip, CheckSquare } from "lucide-react";
import { usePagination } from "@/hooks/usePagination";
import { exportReceivablePdf } from "@/lib/financePdf";
import { toast } from "sonner";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Customer { id: string; name: string; }
interface Receivable {
  id: string; customer_id: string | null; description: string | null;
  amount: number; due_date: string; status: string; paid_at: string | null;
  customers?: { name: string } | null;
  proofs?: { proof_id: string; original_filename: string | null; storage_path: string }[];
}

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

  // Baixa individual
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<Receivable | null>(null);
  const [payAmount, setPayAmount] = useState<string>("");
  const [payFile, setPayFile] = useState<File | null>(null);
  const [paySaving, setPaySaving] = useState(false);

  // Baixa em massa
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkDesc, setBulkDesc] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = async () => {
    try {
      const data = await fetchAll<any>((sb) =>
        sb.from("accounts_receivable")
          .select("*, customers(name)")
          .order("due_date", { ascending: false })
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
          .select("receivable_id, proof_id, payment_proofs(original_filename, storage_path)")
          .in("receivable_id", ids);
        const map = new Map<string, Receivable["proofs"]>();
        (rp ?? []).forEach((row: any) => {
          const arr = map.get(row.receivable_id) ?? [];
          arr!.push({
            proof_id: row.proof_id,
            original_filename: row.payment_proofs?.original_filename ?? null,
            storage_path: row.payment_proofs?.storage_path ?? "",
          });
          map.set(row.receivable_id, arr);
        });
        items.forEach((i) => { i.proofs = map.get(i.id) ?? []; });
      }
      setList(items);

      const cs = await fetchAll<Customer>((sb) =>
        sb.from("customers").select("id, name").order("name")
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
    const parsed = schema.safeParse({
      customer_id: cid && cid !== "none" ? cid : null,
      description: f.get("description"),
      amount: Number(f.get("amount")),
      due_date: f.get("due_date"),
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    const payload = {
      customer_id: parsed.data.customer_id,
      description: parsed.data.description || null,
      amount: parsed.data.amount,
      due_date: parsed.data.due_date,
    };
    const { error } = editing
      ? await supabase.from("accounts_receivable").update(payload).eq("id", editing.id)
      : await supabase.from("accounts_receivable").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Salvo"); setOpen(false); setEditing(null); load();
  };

  // Sobe arquivo (se houver) e cria payment_proof. Retorna proof_id (ou null se nada).
  const uploadProof = async (file: File | null, description: string): Promise<string | null> => {
    if (!file) {
      // Cria proof "vazio" sem arquivo? Aqui retornamos null se não tem arquivo.
      // Para baixa em massa SEM arquivo, ainda criamos um proof só com descrição.
      if (!description) return null;
      const { data, error } = await supabase
        .from("payment_proofs")
        .insert({ storage_path: "", description, payment_date: new Date().toISOString() })
        .select("id").single();
      if (error) throw error;
      return data.id;
    }
    const ext = file.name.split(".").pop() ?? "bin";
    const path = `${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (upErr) throw upErr;
    const { data, error } = await supabase
      .from("payment_proofs")
      .insert({
        storage_path: path,
        original_filename: file.name,
        mime_type: file.type || null,
        file_size: file.size,
        description: description || null,
        payment_date: new Date().toISOString(),
      })
      .select("id").single();
    if (error) throw error;
    return data.id;
  };

  const openPay = (r: Receivable) => {
    setPayTarget(r);
    setPayAmount(String(r.amount));
    setPayFile(null);
    setPayOpen(true);
  };

  const confirmPay = async () => {
    if (!payTarget) return;
    setPaySaving(true);
    try {
      const amt = Number(payAmount);
      if (!(amt > 0)) throw new Error("Valor inválido");
      const proofId = await uploadProof(payFile, `Baixa de ${payTarget.customers?.name ?? "—"}`);
      const { error } = await supabase
        .from("accounts_receivable")
        .update({ status: "pago", paid_at: new Date().toISOString() })
        .eq("id", payTarget.id);
      if (error) throw error;
      if (proofId) {
        await supabase.from("receivable_payments").insert({
          receivable_id: payTarget.id, proof_id: proofId, amount_paid: amt,
        });
      }
      toast.success("Recebimento confirmado");
      setPayOpen(false); setPayTarget(null); setPayFile(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPaySaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir?")) return;
    const { error } = await supabase.from("accounts_receivable").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); load(); }
  };

  const openProof = async (storage_path: string) => {
    if (!storage_path) { toast.error("Comprovante sem arquivo"); return; }
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(storage_path, 60 * 5);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank");
  };

  const filtered = (() => {
    switch (filter) {
      case "todos": return list;
      case "a_receber": return list.filter((r) => r.status === "pendente" || r.status === "vencido");
      case "a_vencer": return list.filter((r) => r.status === "pendente");
      case "vencido": return list.filter((r) => r.status === "vencido");
      case "pago": return list.filter((r) => r.status === "pago");
      default: return list;
    }
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

  // Itens elegíveis para baixa em massa (todas as filtradas que não estão pagas)
  const bulkEligible = filtered.filter((r) => r.status !== "pago" && r.status !== "cancelado");

  const confirmBulk = async () => {
    if (bulkEligible.length === 0) { toast.error("Sem títulos elegíveis"); return; }
    setBulkSaving(true);
    try {
      const proofId = await uploadProof(bulkFile, bulkDesc || `Baixa em massa — ${format(new Date(), "dd/MM/yyyy")}`);
      const ids = bulkEligible.map((r) => r.id);
      const { error } = await supabase
        .from("accounts_receivable")
        .update({ status: "pago", paid_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
      if (proofId) {
        const rows = bulkEligible.map((r) => ({
          receivable_id: r.id, proof_id: proofId, amount_paid: Number(r.amount),
        }));
        const { error: linkErr } = await supabase.from("receivable_payments").insert(rows);
        if (linkErr) throw linkErr;
      }
      toast.success(`${ids.length} título(s) baixados`);
      setBulkOpen(false); setBulkFile(null); setBulkDesc("");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBulkSaving(false);
    }
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
              onClick={() => {
                if (filtered.length === 0) { toast.error("Nada para exportar nesse filtro"); return; }
                exportReceivablePdf(filtered, filterLabels[filter]);
              }}
            >
              <FileDown className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                if (bulkEligible.length === 0) { toast.error("Sem títulos pendentes nesse filtro. Mude para 'A Receber' ou 'Vencido'."); return; }
                setBulkOpen(true);
              }}
              title="Baixa em massa dos títulos filtrados"
            >
              <CheckSquare className="h-4 w-4 mr-1" /> Baixa em massa
            </Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-primary text-primary-foreground shadow-glow rounded-xl">
                  <Plus className="h-4 w-4 mr-1" /> Nova
                </Button>
              </DialogTrigger>
              <DialogContent className="glass-card border-white/40">
                <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} conta a receber</DialogTitle></DialogHeader>
                <form onSubmit={save} className="space-y-3">
                  <div>
                    <Label>Cliente</Label>
                    <Select name="customer_id" defaultValue={editing?.customer_id ?? "none"}>
                      <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— sem cliente —</SelectItem>
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

        <div className="space-y-2">
          {paged.map((r) => (
            <div key={r.id} className="p-3 rounded-xl bg-white/40 backdrop-blur flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{r.customers?.name ?? "—"}</span>
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
                  {r.description || "—"} • Venc: {format(parseISO(r.due_date), "dd/MM/yyyy", { locale: ptBR })}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold">R$ {Number(r.amount).toFixed(2)}</div>
                <div className="flex gap-1 mt-1">
                  {r.status !== "pago" && (
                    <Button size="icon" variant="ghost" onClick={() => openPay(r)} title="Marcar como recebido">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">Nada por aqui</div>}
        </div>
        <Controls />
      </GlassCard>

      {/* Modal: baixa individual */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="glass-card border-white/40">
          <DialogHeader>
            <DialogTitle>Baixa de recebimento</DialogTitle>
          </DialogHeader>
          {payTarget && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {payTarget.customers?.name ?? "—"} • Venc: {format(parseISO(payTarget.due_date), "dd/MM/yyyy", { locale: ptBR })}
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

      {/* Modal: baixa em massa */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="glass-card border-white/40">
          <DialogHeader>
            <DialogTitle>Baixa em massa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              Serão baixados <strong>{bulkEligible.length}</strong> título(s) filtrados em "{filterLabels[filter]}",
              totalizando <strong>R$ {sum(bulkEligible).toFixed(2)}</strong>.
            </div>
            <div>
              <Label>Descrição</Label>
              <Input
                value={bulkDesc}
                onChange={(e) => setBulkDesc(e.target.value)}
                placeholder={`Baixa em massa — ${format(new Date(), "dd/MM/yyyy")}`}
                className="glass-input"
              />
            </div>
            <div>
              <Label>Comprovante (opcional)</Label>
              <Input
                type="file"
                onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)}
                className="glass-input"
                accept="image/*,application/pdf,.xlsx,.xls,.csv"
              />
              {bulkFile && <div className="text-xs text-muted-foreground mt-1">{bulkFile.name}</div>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkSaving}>Cancelar</Button>
            <Button onClick={confirmBulk} disabled={bulkSaving || bulkEligible.length === 0} className="bg-gradient-primary text-primary-foreground">
              {bulkSaving ? "Salvando..." : `Baixar ${bulkEligible.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
