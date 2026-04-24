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
import { Plus, Pencil, Trash2, CheckCircle2, FileDown, Paperclip, CheckSquare, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { usePagination } from "@/hooks/usePagination";
import { exportReceivablePdf } from "@/lib/financePdf";
import { toast } from "sonner";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { digitsOnly, formatTaxId } from "@/lib/taxId";

interface Customer { id: string; name: string; tax_id: string | null; }
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

  // Relatório
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<"todos" | "1m" | "1a" | "custom">("todos");
  const [reportFrom, setReportFrom] = useState<string>("");
  const [reportTo, setReportTo] = useState<string>("");

  // Importar
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ customer_name: string; tax_id: string; description: string; amount: number; due_date: string }[]>([]);
  const [importSaving, setImportSaving] = useState(false);

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
        sb.from("customers").select("id, name, tax_id").order("name")
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

  // === Relatório com filtro de período ===
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

    const rows = filtered.filter((r) => {
      if (!fromIso) return true;
      return r.due_date >= fromIso && r.due_date <= toIso;
    });
    if (rows.length === 0) { toast.error("Nenhum lançamento no período selecionado"); return; }

    const labelMap: Record<string, string> = {
      todos: "todos os períodos",
      "1m": "último mês",
      "1a": "último ano",
      custom: `${reportFrom} a ${reportTo}`,
    };
    exportReceivablePdf(rows, `${filterLabels[filter]} • ${labelMap[reportPeriod]}`);
    setReportOpen(false);
  };

  // === Importação de planilha/PDF ===
  const [importParsing, setImportParsing] = useState(false);

  const parseImportFile = async (file: File) => {
    setImportParsing(true);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        // PDF: enviar pra edge function que usa IA pra extrair
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
        }
        const b64 = btoa(binary);
        toast.info("Lendo PDF com IA, aguarde...");
        const { data, error } = await supabase.functions.invoke("parse-receivables-pdf", {
          body: { file_base64: b64, filename: file.name },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        const items = (data?.items ?? []).filter((r: any) => r.amount > 0 && r.due_date) as any[];
        setImportPreview(items.map((r: any) => ({
          customer_name: r.customer_name ?? "",
          tax_id: digitsOnly(r.tax_id ?? ""),
          description: r.description ?? "",
          amount: Number(r.amount),
          due_date: String(r.due_date).slice(0, 10),
        })));
        const meta = data?.meta;
        const sum = items.reduce((a: number, b: any) => a + (Number(b.amount) || 0), 0);
        if (items.length === 0) {
          toast.error("Nenhum lançamento encontrado no PDF");
        } else if (meta?.expected_count && Math.abs(meta.expected_count - items.length) > 2) {
          toast.warning(
            `Atenção: extraídas ${items.length} de ~${meta.expected_count} linhas esperadas (R$ ${sum.toFixed(2)} de ~R$ ${(meta.expected_sum ?? 0).toFixed(2)}). Confira o PDF.`,
            { duration: 10000 }
          );
        } else if (meta?.expected_sum && Math.abs(meta.expected_sum - sum) > 1) {
          toast.warning(
            `Extraídas ${items.length} linhas (R$ ${sum.toFixed(2)}) — esperado R$ ${meta.expected_sum.toFixed(2)}. Confira antes de confirmar.`,
            { duration: 10000 }
          );
        } else {
          toast.success(`${items.length} linha(s) extraídas • Total R$ ${sum.toFixed(2)}`);
        }
        return;
      }

      // Planilha (xlsx/xls/csv)
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

      const norm = (s: string) => String(s ?? "").toLowerCase().trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const findKey = (row: any, candidates: string[]) => {
        const keys = Object.keys(row);
        for (const c of candidates) {
          const k = keys.find((k) => norm(k) === norm(c) || norm(k).includes(norm(c)));
          if (k) return k;
        }
        return null;
      };

      const parseAmount = (v: any): number => {
        if (typeof v === "number") return v;
        const s = String(v ?? "").replace(/[^\d,.\-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
        return Number(s) || 0;
      };

      const parseDate = (v: any): string => {
        if (!v) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const s = String(v).trim();
        const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if (m) {
          const yy = m[3].length === 2 ? "20" + m[3] : m[3];
          return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
        }
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
      };

      const out = json.map((row) => {
        const kCust = findKey(row, ["cliente", "customer", "nome", "sacado", "pagador"]);
        const kTax = findKey(row, ["cpf", "cnpj", "cpf/cnpj", "documento", "tax_id"]);
        const kDesc = findKey(row, ["descricao", "description", "historico", "memo", "obs"]);
        const kAmt = findKey(row, ["valor", "amount", "montante"]);
        const kDue = findKey(row, ["vencimento", "due_date", "data", "vencto"]);
        return {
          customer_name: kCust ? String(row[kCust]).trim() : "",
          tax_id: kTax ? digitsOnly(String(row[kTax])) : "",
          description: kDesc ? String(row[kDesc]).trim() : "",
          amount: kAmt ? parseAmount(row[kAmt]) : 0,
          due_date: kDue ? parseDate(row[kDue]) : "",
        };
      }).filter((r) => r.amount > 0 && r.due_date);

      setImportPreview(out);
      if (out.length === 0) toast.error("Nenhuma linha válida encontrada (precisa de Valor + Vencimento)");
      else toast.success(`${out.length} linha(s) prontas para importar`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao ler o arquivo");
    } finally {
      setImportParsing(false);
    }
  };

  const confirmImport = async () => {
    if (importPreview.length === 0) { toast.error("Nada para importar"); return; }
    setImportSaving(true);
    try {
      // Índices: por CPF/CNPJ e por nome (lowercase)
      const taxToId = new Map<string, string>();
      const nameToId = new Map<string, string>();
      const taxToCustomer = new Map<string, Customer>();
      customers.forEach((c) => {
        const t = digitsOnly(c.tax_id ?? "");
        if (t) { taxToId.set(t, c.id); taxToCustomer.set(t, c); }
        if (c.name) nameToId.set(c.name.toLowerCase(), c.id);
      });

      // 1) Para cada linha, decide o customer_id
      // - se tem tax_id e existe → usa
      // - se tem tax_id e NÃO existe, mas existe cliente com mesmo nome sem tax_id → atualiza esse cliente com o tax_id
      // - se tem tax_id e nada bate → cria novo cliente (nome + tax_id)
      // - se NÃO tem tax_id → vincula por nome; se não existir, cria por nome
      const toUpdateTax: { id: string; tax_id: string }[] = [];
      const planned: (string | null)[] = importPreview.map(() => null);

      // Primeira passada: vincular ou marcar para update/create
      const pendingNewByTax = new Map<string, number[]>(); // tax_id → índices das linhas
      const pendingNewByName = new Map<string, number[]>(); // nome.lower → índices

      importPreview.forEach((r, idx) => {
        const tax = digitsOnly(r.tax_id);
        const nameKey = (r.customer_name || "").trim().toLowerCase();

        if (tax) {
          if (taxToId.has(tax)) {
            planned[idx] = taxToId.get(tax)!;
          } else if (nameKey && nameToId.has(nameKey)) {
            const existingId = nameToId.get(nameKey)!;
            const existing = customers.find((c) => c.id === existingId);
            // Atualiza tax_id desse cliente (se ainda não tinha)
            if (existing && !digitsOnly(existing.tax_id ?? "")) {
              toUpdateTax.push({ id: existingId, tax_id: tax });
              taxToId.set(tax, existingId);
            }
            planned[idx] = existingId;
          } else {
            // Novo por tax_id
            const arr = pendingNewByTax.get(tax) ?? [];
            arr.push(idx);
            pendingNewByTax.set(tax, arr);
          }
        } else if (nameKey) {
          if (nameToId.has(nameKey)) {
            planned[idx] = nameToId.get(nameKey)!;
          } else {
            const arr = pendingNewByName.get(nameKey) ?? [];
            arr.push(idx);
            pendingNewByName.set(nameKey, arr);
          }
        }
      });

      // Atualiza tax_id de clientes existentes encontrados por nome
      if (toUpdateTax.length > 0) {
        for (const u of toUpdateTax) {
          const { error } = await supabase.from("customers").update({ tax_id: u.tax_id }).eq("id", u.id);
          if (error) throw error;
        }
      }

      // Cria os novos clientes (com tax_id e por nome)
      const newPayload: { name: string; tax_id: string | null }[] = [];
      const newKeys: { kind: "tax" | "name"; key: string }[] = [];

      for (const [tax, idxs] of pendingNewByTax.entries()) {
        const sample = importPreview[idxs[0]];
        newPayload.push({ name: (sample.customer_name || "Cliente sem nome").trim(), tax_id: tax });
        newKeys.push({ kind: "tax", key: tax });
      }
      for (const [nameKey, idxs] of pendingNewByName.entries()) {
        const sample = importPreview[idxs[0]];
        newPayload.push({ name: (sample.customer_name || "Cliente sem nome").trim(), tax_id: null });
        newKeys.push({ kind: "name", key: nameKey });
      }

      if (newPayload.length > 0) {
        const { data: created, error: cErr } = await supabase
          .from("customers")
          .insert(newPayload)
          .select("id, name, tax_id");
        if (cErr) throw cErr;
        (created ?? []).forEach((c, i) => {
          const meta = newKeys[i];
          if (meta.kind === "tax") {
            const idxs = pendingNewByTax.get(meta.key) ?? [];
            idxs.forEach((idx) => { planned[idx] = c.id; });
          } else {
            const idxs = pendingNewByName.get(meta.key) ?? [];
            idxs.forEach((idx) => { planned[idx] = c.id; });
          }
        });
      }

      const rows = importPreview.map((r, idx) => ({
        customer_id: planned[idx],
        description: r.description || null,
        amount: r.amount,
        due_date: r.due_date,
      }));

      const { error } = await supabase.from("accounts_receivable").insert(rows);
      if (error) throw error;

      const stats = {
        total: rows.length,
        updated: toUpdateTax.length,
        created: newPayload.length,
      };
      toast.success(`${stats.total} conta(s) importadas • ${stats.created} cliente(s) novo(s) • ${stats.updated} atualizado(s)`);
      setImportOpen(false); setImportFile(null); setImportPreview([]);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setImportSaving(false);
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
              onClick={() => { setReportPeriod("todos"); setReportOpen(true); }}
            >
              <FileDown className="h-4 w-4 mr-1" /> Relatório
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => { setImportFile(null); setImportPreview([]); setImportOpen(true); }}
            >
              <Upload className="h-4 w-4 mr-1" /> Importar
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

      {/* Modal: Relatório com filtro de período */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="glass-card border-white/40">
          <DialogHeader><DialogTitle>Gerar relatório</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Filtro atual: <strong>{filterLabels[filter]}</strong> ({filtered.length} título(s))
            </div>
            <div>
              <Label>Período</Label>
              <Select value={reportPeriod} onValueChange={(v) => setReportPeriod(v as any)}>
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
            <Button variant="outline" onClick={() => setReportOpen(false)}>Cancelar</Button>
            <Button onClick={runReport} className="bg-gradient-primary text-primary-foreground">
              <FileDown className="h-4 w-4 mr-1" /> Gerar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Importar contas a receber */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="glass-card border-white/40 max-w-2xl">
          <DialogHeader><DialogTitle>Importar contas a receber</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Anexe um arquivo <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong> ou <strong>.pdf</strong>.
              Em planilhas, use colunas: <strong>Cliente</strong>, <strong>Descrição</strong>, <strong>Valor</strong> e <strong>Vencimento</strong>.
              PDFs (extratos bancários) são lidos automaticamente pela IA.
              Clientes novos serão cadastrados automaticamente.
            </div>
            <div>
              <Label>Arquivo</Label>
              <Input
                type="file"
                accept=".xlsx,.xls,.csv,.pdf"
                disabled={importParsing}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setImportFile(f);
                  setImportPreview([]);
                  if (f) parseImportFile(f);
                }}
                className="glass-input"
              />
              {importFile && <div className="text-xs text-muted-foreground mt-1">{importFile.name}</div>}
              {importParsing && <div className="text-xs text-primary mt-1">Lendo arquivo...</div>}
            </div>
            {importPreview.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-lg border border-white/30">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Cliente</th>
                      <th className="text-left p-2">CPF/CNPJ</th>
                      <th className="text-left p-2">Vínculo</th>
                      <th className="text-left p-2">Descrição</th>
                      <th className="text-left p-2">Vencimento</th>
                      <th className="text-right p-2">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.slice(0, 50).map((r, i) => {
                      const tax = digitsOnly(r.tax_id);
                      const byTax = tax ? customers.find((c) => digitsOnly(c.tax_id ?? "") === tax) : null;
                      const byName = !byTax && r.customer_name
                        ? customers.find((c) => c.name.toLowerCase() === r.customer_name.toLowerCase())
                        : null;
                      const matched = byTax || byName;
                      return (
                        <tr key={i} className="border-t border-white/20">
                          <td className="p-2">{r.customer_name || "—"}</td>
                          <td className="p-2 font-mono text-[11px]">{tax ? formatTaxId(tax) : "—"}</td>
                          <td className="p-2">
                            {matched ? (
                              <span className="text-success text-[11px]">✓ vinculado{byTax ? " (CPF/CNPJ)" : " (nome)"}</span>
                            ) : (
                              <span className="text-amber-600 text-[11px]">+ novo cadastro</span>
                            )}
                          </td>
                          <td className="p-2">{r.description || "—"}</td>
                          <td className="p-2">{r.due_date}</td>
                          <td className="p-2 text-right">R$ {r.amount.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {importPreview.length > 50 && (
                  <div className="p-2 text-center text-xs text-muted-foreground">
                    ... e mais {importPreview.length - 50} linha(s)
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importSaving}>Cancelar</Button>
            <Button
              onClick={confirmImport}
              disabled={importSaving || importPreview.length === 0}
              className="bg-gradient-primary text-primary-foreground"
            >
              {importSaving ? "Importando..." : `Importar ${importPreview.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
