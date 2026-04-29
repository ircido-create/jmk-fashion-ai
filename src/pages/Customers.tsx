import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Search, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Link } from "react-router-dom";
import { usePagination } from "@/hooks/usePagination";
import { digitsOnly, formatTaxId, isValidTaxIdLength } from "@/lib/taxId";

interface Customer { id: string; name: string; nickname: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; tax_id: string | null; }

const schema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(100),
  nickname: z.string().trim().max(60).optional().or(z.literal("")),
  tax_id: z.string().trim().max(20).optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("E-mail inválido").max(255).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export default function Customers() {
  const [list, setList] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const [cep, setCep] = useState("");
  const [cepLoading, setCepLoading] = useState(false);
  const addressRef = useRef<HTMLTextAreaElement>(null);

  const formatCep = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 8);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  };

  const lookupCep = async () => {
    const d = cep.replace(/\D/g, "");
    if (d.length !== 8) { toast.error("CEP deve ter 8 dígitos"); return; }
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const j = await res.json();
      if (j.erro) { toast.error("CEP não encontrado"); return; }
      const parts = [
        j.logradouro,
        j.bairro,
        j.localidade && j.uf ? `${j.localidade} - ${j.uf}` : (j.localidade || j.uf),
        `CEP ${formatCep(d)}`,
      ].filter(Boolean);
      if (addressRef.current) {
        addressRef.current.value = parts.join(", ");
        addressRef.current.focus();
      }
      toast.success("Endereço preenchido");
    } catch {
      toast.error("Erro ao buscar CEP");
    } finally {
      setCepLoading(false);
    }
  };


  const load = async () => {
    try {
      const all = await fetchAll<Customer>((sb) =>
        sb.from("customers").select("*").order("name")
      );
      setList(all);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = schema.safeParse({
      name: f.get("name"), nickname: f.get("nickname"), tax_id: f.get("tax_id"), phone: f.get("phone"), email: f.get("email"), address: f.get("address"), notes: f.get("notes"),
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    const taxIdDigits = digitsOnly(parsed.data.tax_id);
    if (!isValidTaxIdLength(taxIdDigits)) {
      toast.error("CPF deve ter 11 dígitos ou CNPJ 14 dígitos");
      return;
    }
    const payload = {
      name: parsed.data.name,
      nickname: parsed.data.nickname || null,
      tax_id: taxIdDigits || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      address: parsed.data.address || null,
      notes: parsed.data.notes || null,
    };
    const { error } = editing
      ? await supabase.from("customers").update(payload).eq("id", editing.id)
      : await supabase.from("customers").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "Cliente atualizado" : "Cliente cadastrado");
    setOpen(false); setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este cliente?")) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Excluído"); load(); }
  };

  const searchDigits = digitsOnly(search);
  const filtered = list.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.nickname ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").includes(search) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (searchDigits.length >= 3 && (c.tax_id ?? "").includes(searchDigits))
    );
  });
  const { paged, Controls } = usePagination(filtered, 20);

  return (
    <div>
      <PageHeader
        title="Clientes"
        description={`${list.length} clientes cadastrados`}
        actions={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setCep(""); } }}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary text-primary-foreground shadow-glow rounded-xl">
                <Plus className="h-4 w-4 mr-1" /> Novo
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-card border-white/40">
              <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} cliente</DialogTitle></DialogHeader>
              <form onSubmit={save} className="space-y-3">
                <div><Label>Nome completo</Label><Input name="name" defaultValue={editing?.name} required className="glass-input" /></div>
                <div><Label>Apelido (usado na conciliação do extrato)</Label><Input name="nickname" defaultValue={editing?.nickname ?? ""} placeholder="Ex.: Maria do Bairro" className="glass-input" /></div>
                <div><Label>CPF / CNPJ</Label><Input name="tax_id" defaultValue={formatTaxId(editing?.tax_id)} placeholder="000.000.000-00" className="glass-input" /></div>
                <div><Label>Telefone (ex: +5511999999999)</Label><Input name="phone" defaultValue={editing?.phone ?? ""} className="glass-input" /></div>
                <div><Label>E-mail</Label><Input name="email" type="email" defaultValue={editing?.email ?? ""} className="glass-input" /></div>
                <div>
                  <Label>CEP (busca automática do endereço)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={cep}
                      onChange={(e) => setCep(formatCep(e.target.value))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupCep(); } }}
                      placeholder="00000-000"
                      inputMode="numeric"
                      className="glass-input"
                    />
                    <Button type="button" onClick={lookupCep} disabled={cepLoading} variant="secondary" className="rounded-xl">
                      {cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div><Label>Endereço</Label><Textarea ref={addressRef} name="address" defaultValue={editing?.address ?? ""} placeholder="Rua, número, bairro, cidade — UF, CEP" className="glass-input" rows={2} /></div>
                <div><Label>Observações</Label><Textarea name="notes" defaultValue={editing?.notes ?? ""} className="glass-input" rows={3} /></div>
                <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground rounded-xl">Salvar</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <GlassCard>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, telefone, e-mail ou CPF/CNPJ..." className="glass-input pl-10" />
        </div>

        <div className="space-y-2">
          {paged.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur hover:bg-white/60 dark:hover:bg-white/10 transition-all">
              <Link to={`/clientes/${c.id}`} className="min-w-0 flex-1 group">
                <div className="font-medium truncate flex items-center gap-1 group-hover:text-primary transition-colors">
                  {c.name}
                  {c.nickname && (
                    <span className="text-xs text-muted-foreground font-normal">({c.nickname})</span>
                  )}
                  <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {c.tax_id ? formatTaxId(c.tax_id) : "—"} {c.phone ? `• ${c.phone}` : ""} {c.email ? `• ${c.email}` : ""}
                </div>
                {c.address && <div className="text-xs text-muted-foreground truncate mt-0.5">📍 {c.address}</div>}
              </Link>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">Nenhum cliente</div>
          )}
        </div>
        <Controls />
      </GlassCard>
    </div>
  );
}
