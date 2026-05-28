import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, CheckCircle2, FileDown } from "lucide-react";
import { usePagination } from "@/hooks/usePagination";
import { exportPayablePdf } from "@/lib/financePdf";
import { toast } from "sonner";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Payable {
  id: string; supplier: string; description: string | null; amount: number;
  due_date: string; status: string; category: string | null; paid_at: string | null;
}

const schema = z.object({
  supplier: z.string().trim().min(2).max(100),
  description: z.string().trim().max(200).optional().or(z.literal("")),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  amount: z.number().positive(),
  due_date: z.string().min(1),
});

const statusColor: Record<string, string> = {
  pendente: "bg-blue-500/15 text-blue-700",
  pago: "bg-success/15 text-success",
  vencido: "bg-destructive/15 text-destructive",
  cancelado: "bg-muted text-muted-foreground",
};

export default function Payable() {
  const [list, setList] = useState<Payable[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Payable | null>(null);
  // Filtros: a_pagar (default, inclui pendente+vencido), a_vencer, vencido, pago, todos
  const [filter, setFilter] = useState<string>("a_pagar");

  const load = async () => {
    try {
      const data = await fetchAll<any>((sb) =>
        sb.from("accounts_payable").select("*").order("due_date", { ascending: false })
      );
      const today = new Date().toISOString().slice(0, 10);
      setList(data.map((r: any) => ({
        ...r,
        status: r.status === "pendente" && r.due_date < today ? "vencido" : r.status,
      })));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = schema.safeParse({
      supplier: f.get("supplier"),
      description: f.get("description"),
      category: f.get("category"),
      amount: Number(f.get("amount")),
      due_date: f.get("due_date"),
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    const payload = {
      supplier: parsed.data.supplier,
      description: parsed.data.description || null,
      category: parsed.data.category || null,
      amount: parsed.data.amount,
      due_date: parsed.data.due_date,
    };
    const { error } = editing
      ? await supabase.from("accounts_payable").update(payload).eq("id", editing.id)
      : await supabase.from("accounts_payable").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Salvo"); setOpen(false); setEditing(null); load();
  };

  const markPaid = async (id: string) => {
    const { error } = await supabase.from("accounts_payable")
      .update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Marcado como pago"); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir?")) return;
    const { error } = await supabase.from("accounts_payable").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); load(); }
  };

  const filtered = (() => {
    switch (filter) {
      case "todos": return list;
      case "a_pagar": return list.filter((r) => r.status === "pendente" || r.status === "vencido");
      case "a_vencer": return list.filter((r) => r.status === "pendente");
      case "vencido": return list.filter((r) => r.status === "vencido");
      case "pago": return list.filter((r) => r.status === "pago");
      default: return list;
    }
  })();
  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);

  const sum = (arr: Payable[]) => arr.reduce((s, r) => s + Number(r.amount), 0);
  const aPagarAll = list.filter((r) => r.status === "pendente" || r.status === "vencido");
  const vencidoAll = list.filter((r) => r.status === "vencido");
  const pagoAll = list.filter((r) => r.status === "pago");

  const { paged, Controls } = usePagination(filtered, 20);

  const filterLabels: Record<string, string> = {
    todos: "Todos",
    a_pagar: "A Pagar",
    a_vencer: "A Vencer",
    vencido: "Vencido",
    pago: "Pago",
  };

  return (
    <div>
      <PageHeader
        title="Contas a Pagar"
        description={`${filterLabels[filter]}: R$ ${total.toFixed(2)} • ${filtered.length} título(s)`}
        actions={
          <>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => exportPayablePdf(filtered, filterLabels[filter])}
              disabled={filtered.length === 0}
            >
              <FileDown className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-primary text-primary-foreground shadow-glow rounded-xl">
                  <Plus className="h-4 w-4 mr-1" /> Nova
                </Button>
              </DialogTrigger>
              <DialogContent className="glass-card border-white/40">
                <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} conta a pagar</DialogTitle></DialogHeader>
                <form onSubmit={save} className="space-y-3">
                  <div><Label>Fornecedor</Label><Input name="supplier" defaultValue={editing?.supplier} required className="glass-input" /></div>
                  <div><Label>Descrição</Label><Input name="description" defaultValue={editing?.description ?? ""} className="glass-input" /></div>
                  <div><Label>Categoria</Label><Input name="category" defaultValue={editing?.category ?? ""} placeholder="Aluguel, Energia..." className="glass-input" /></div>
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="glass-card p-4">
          <div className="text-xs text-muted-foreground">A Pagar (total)</div>
          <div className="text-2xl font-bold gradient-text">R$ {sum(aPagarAll).toFixed(2)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{aPagarAll.length} título(s)</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-muted-foreground">↳ Vencido</div>
          <div className="text-2xl font-bold text-destructive">R$ {sum(vencidoAll).toFixed(2)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{vencidoAll.length} título(s)</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-muted-foreground">Pago</div>
          <div className="text-2xl font-bold text-success">R$ {sum(pagoAll).toFixed(2)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{pagoAll.length} título(s)</div>
        </div>
      </div>

      <GlassCard>
        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            { k: "a_pagar", label: "A Pagar" },
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
                  <span className="font-medium">{r.supplier}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColor[r.status]}`}>{r.status}</span>
                  {r.category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary">{r.category}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.description || "—"} • Venc: {format(parseISO(r.due_date), "dd/MM/yyyy", { locale: ptBR })}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold">R$ {Number(r.amount).toFixed(2)}</div>
                <div className="flex gap-1 mt-1">
                  {r.status !== "pago" && (
                    <Button size="icon" variant="ghost" onClick={() => markPaid(r.id)} aria-label="Marcar como pago">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(r.id)} aria-label="Excluir"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">Nada por aqui</div>}
        </div>
        <Controls />
      </GlassCard>
    </div>
  );
}
