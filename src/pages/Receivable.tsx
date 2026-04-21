import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { format, isBefore, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Customer { id: string; name: string; }
interface Receivable {
  id: string; customer_id: string | null; description: string | null;
  amount: number; due_date: string; status: string; paid_at: string | null;
  customers?: { name: string } | null;
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
  const [filter, setFilter] = useState<string>("todos");

  const load = async () => {
    try {
      const data = await fetchAll<any>((sb) =>
        sb.from("accounts_receivable")
          .select("*, customers(name)")
          .order("due_date", { ascending: false })
      );
      const today = new Date().toISOString().slice(0, 10);
      setList(data.map((r: any) => ({
        ...r,
        status: r.status === "pendente" && r.due_date < today ? "vencido" : r.status,
      })));
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

  const markPaid = async (id: string) => {
    const { error } = await supabase.from("accounts_receivable")
      .update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Recebimento confirmado"); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir?")) return;
    const { error } = await supabase.from("accounts_receivable").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); load(); }
  };

  const filtered = filter === "todos" ? list : list.filter((r) => r.status === filter);
  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div>
      <PageHeader
        title="Contas a Receber"
        description={`Total filtrado: R$ ${total.toFixed(2)}`}
        actions={
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
        }
      />

      <GlassCard>
        <div className="flex gap-2 mb-4 flex-wrap">
          {["todos", "pendente", "vencido", "pago"].map((s) => (
            <Button key={s} size="sm" variant={filter === s ? "default" : "outline"}
              onClick={() => setFilter(s)}
              className={filter === s ? "bg-gradient-primary text-primary-foreground" : ""}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.map((r) => (
            <div key={r.id} className="p-3 rounded-xl bg-white/40 backdrop-blur flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{r.customers?.name ?? "—"}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColor[r.status]}`}>{r.status}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.description || "—"} • Venc: {format(parseISO(r.due_date), "dd/MM/yyyy", { locale: ptBR })}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold">R$ {Number(r.amount).toFixed(2)}</div>
                <div className="flex gap-1 mt-1">
                  {r.status !== "pago" && (
                    <Button size="icon" variant="ghost" onClick={() => markPaid(r.id)} title="Marcar como recebido">
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
      </GlassCard>
    </div>
  );
}
