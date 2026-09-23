import { useEffect, useMemo, useState } from "react";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { reconcileManualPayment, type ReceivableLite } from "@/lib/reconcile";
import { FileText, Image as ImageIcon, ExternalLink, Sparkles, Search, Plus, Upload, Trash2, CheckCircle2, Ban, RotateCcw } from "lucide-react";
import { z } from "zod";

interface Proof {
  id: string;
  created_at: string;
  storage_path: string;
  bucket: string | null;
  original_filename: string | null;
  mime_type: string | null;
  source: string;
  customer_id: string | null;
  ai_is_payment_proof: boolean | null;
  ai_amount: number | null;
  ai_payer_name: string | null;
  ai_bank: string | null;
  ai_transaction_id: string | null;
  ai_summary: string | null;
  settlement_status: SettlementStatus | null;
  settlement_note: string | null;
  settled_at: string | null;
  customer?: { name: string | null; phone: string | null } | null;
  receivable_payments?: {
    amount_paid: number;
    accounts_receivable?: { description: string | null; due_date: string } | null;
  }[];
}

interface CustomerOpt { id: string; name: string; phone: string | null }

type SettlementStatus = "auto" | "manual" | "pendente" | "ignorado";
type StatusFilter = "todos" | SettlementStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "auto", label: "Baixa automática" },
  { value: "pendente", label: "Aguardando baixa manual" },
  { value: "manual", label: "Baixa manual" },
  { value: "ignorado", label: "Descartados" },
];

interface OpenReceivable { id: string; description: string | null; amount: number; due_date: string; status: string }

const formatDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const currency = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const manualSchema = z.object({
  customer_id: z.string().uuid().nullable(),
  payer_name: z.string().trim().max(200).optional(),
  bank: z.string().trim().max(100).optional(),
  amount: z.number().positive().max(1_000_000).nullable(),
  transaction_id: z.string().trim().max(120).optional(),
  payment_date: z.string().min(1),
  description: z.string().trim().max(1000).optional(),
});

export default function PaymentProofs() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyValid, setOnlyValid] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("payment_proofs_only_valid") === "1";
  });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [statusCounts, setStatusCounts] = useState<Partial<Record<StatusFilter, number>>>({});

  // ---- Baixa manual a partir do comprovante ----
  const [settleTarget, setSettleTarget] = useState<Proof | null>(null);
  const [settleCustomerId, setSettleCustomerId] = useState("");
  const [settleCustomerQuery, setSettleCustomerQuery] = useState("");
  const [settleAmount, setSettleAmount] = useState("");
  const [settleDate, setSettleDate] = useState("");
  const [settleOpenList, setSettleOpenList] = useState<OpenReceivable[]>([]);
  const [settleSelected, setSettleSelected] = useState<string[]>([]);
  const [settleSaving, setSettleSaving] = useState(false);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("payment_proofs_only_valid", onlyValid ? "1" : "0");
  }, [onlyValid]);

  // ---- Manual create ----
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [form, setForm] = useState({
    customer_id: "" as string,
    payer_name: "",
    bank: "",
    amount: "",
    transaction_id: "",
    payment_date: new Date().toISOString().slice(0, 10),
    description: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadCustomers = async () => {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone")
      .order("name", { ascending: true })
      .limit(500);
    setCustomers((data ?? []) as CustomerOpt[]);
  };

  const loadCounts = async () => {
    const statuses: SettlementStatus[] = ["auto", "pendente", "manual", "ignorado"];
    const results = await Promise.all(statuses.map((st) =>
      supabase.from("payment_proofs").select("id", { count: "exact", head: true }).eq("settlement_status", st)
    ));
    const counts: Partial<Record<StatusFilter, number>> = {};
    statuses.forEach((st, i) => { counts[st] = results[i].count ?? 0; });
    setStatusCounts(counts);
  };

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("payment_proofs")
      .select("id, created_at, storage_path, bucket, original_filename, mime_type, source, customer_id, ai_is_payment_proof, ai_amount, ai_payer_name, ai_bank, ai_transaction_id, ai_summary, settlement_status, settlement_note, settled_at, customers(name, phone)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusFilter !== "todos") query = query.eq("settlement_status", statusFilter);
    const { data, error } = await query;
    loadCounts();
    if (error) {
      toast({ title: "Erro ao carregar comprovantes", description: error.message, variant: "destructive" });
    } else {
      const proofRows = data ?? [];
      const proofIds = proofRows.map((proof) => proof.id);
      const { data: paymentRows, error: paymentsError } = proofIds.length > 0
        ? await supabase
          .from("receivable_payments")
          .select("proof_id, amount_paid, accounts_receivable(description, due_date)")
          .in("proof_id", proofIds)
        : { data: [], error: null };
      if (paymentsError) console.warn("receivable_payments load:", paymentsError.message);
      const paymentsByProof: Record<string, Proof["receivable_payments"]> = {};
      for (const payment of paymentRows ?? []) {
        const current = paymentsByProof[payment.proof_id] ?? [];
        current.push({ amount_paid: Number(payment.amount_paid), accounts_receivable: payment.accounts_receivable ?? null });
        paymentsByProof[payment.proof_id] = current;
      }
      const rows: Proof[] = proofRows.map((r: any) => ({
        ...r,
        customer: r.customers,
        receivable_payments: paymentsByProof[r.id] ?? [],
      }));
      setProofs(rows);

      // URLs assinadas para whatsapp-media (edge function)
      const wPaths = rows.filter((r) => (r.bucket ?? "payment-proofs") === "whatsapp-media").map((r) => r.storage_path);
      if (wPaths.length > 0) {
        const { data: signed } = await supabase.functions.invoke("whatsapp-media-url", { body: { paths: wPaths } });
        if (signed?.urls) setUrls((prev) => ({ ...prev, ...signed.urls }));
      }

      // URLs assinadas para payment-proofs (client SDK)
      const pPaths = rows.filter((r) => (r.bucket ?? "payment-proofs") === "payment-proofs" && !r.storage_path.startsWith("manual/no-file/"));
      const signedMap: Record<string, string> = {};
      await Promise.all(pPaths.map(async (r) => {
        const { data: s } = await supabase.storage.from("payment-proofs").createSignedUrl(r.storage_path, 60 * 60);
        if (s?.signedUrl) signedMap[r.storage_path] = s.signedUrl;
      }));
      if (Object.keys(signedMap).length) setUrls((prev) => ({ ...prev, ...signedMap }));
    }
    setLoading(false);
  };

  useEffect(() => { loadCustomers(); }, []);
  useEffect(() => { load(); }, [statusFilter]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = proofs;
    if (onlyValid) list = list.filter((p) => p.ai_is_payment_proof === true);
    if (!term) return list;
    return list.filter((p) =>
      [p.ai_payer_name, p.ai_bank, p.ai_transaction_id, p.ai_summary, p.customer?.name, p.customer?.phone, p.original_filename]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
    );
  }, [proofs, q, onlyValid]);

  const filteredCustomers = useMemo(() => {
    const t = customerQuery.trim().toLowerCase();
    if (!t) return customers.slice(0, 100);
    return customers.filter((c) =>
      c.name?.toLowerCase().includes(t) || (c.phone ?? "").toLowerCase().includes(t)
    ).slice(0, 100);
  }, [customers, customerQuery]);

  const resetForm = () => {
    setForm({
      customer_id: "",
      payer_name: "",
      bank: "",
      amount: "",
      transaction_id: "",
      payment_date: new Date().toISOString().slice(0, 10),
      description: "",
    });
    setFile(null);
    setCustomerQuery("");
  };

  const submitManual = async () => {
    const parsed = manualSchema.safeParse({
      customer_id: form.customer_id || null,
      payer_name: form.payer_name || undefined,
      bank: form.bank || undefined,
      amount: form.amount ? Number(form.amount.replace(",", ".")) : null,
      transaction_id: form.transaction_id || undefined,
      payment_date: form.payment_date,
      description: form.description || undefined,
    });
    if (!parsed.success) {
      toast({ title: "Verifique os campos", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const id = crypto.randomUUID();
      let storage_path = `manual/no-file/${id}`;
      let mime_type: string | null = null;
      let file_size: number | null = null;
      let original_filename: string | null = null;

      if (file) {
        const ext = file.name.split(".").pop() ?? "bin";
        storage_path = `manual/${id}.${ext}`;
        mime_type = file.type || null;
        file_size = file.size;
        original_filename = file.name;
        const { error: upErr } = await supabase.storage
          .from("payment-proofs")
          .upload(storage_path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
      }

      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("payment_proofs").insert({
        storage_path,
        bucket: "payment-proofs",
        original_filename,
        mime_type,
        file_size,
        source: "manual",
        customer_id: parsed.data.customer_id,
        payment_date: new Date(parsed.data.payment_date).toISOString(),
        description: parsed.data.description ?? null,
        ai_is_payment_proof: true,
        ai_amount: parsed.data.amount,
        ai_payer_name: parsed.data.payer_name ?? null,
        ai_bank: parsed.data.bank ?? null,
        ai_transaction_id: parsed.data.transaction_id ?? null,
        ai_summary: parsed.data.description ?? null,
        created_by: userData.user?.id ?? null,
      });
      if (error) throw error;

      toast({ title: "Comprovante criado com sucesso" });
      setOpen(false);
      resetForm();
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message ?? "Tente novamente", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteProof = async (p: Proof) => {
    const allocated = (p.receivable_payments ?? []).reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
    const restoreText = allocated > 0
      ? ` O pagamento de ${currency(allocated)} será estornado e voltará para as parcelas.`
      : "";
    if (!confirm(`Excluir este comprovante${p.customer?.name ? ` de ${p.customer.name}` : ""}?${restoreText} Esta ação não pode ser desfeita.`)) return;
    setDeletingId(p.id);
    try {
      const bucket = p.bucket ?? "payment-proofs";
      const noFile = p.storage_path.startsWith("manual/no-file/");
      const { data: reversal, error } = await supabase.rpc("reverse_payment_proof", { p_proof_id: p.id });
      if (error) throw error;
      if (!noFile) {
        const { error: sErr } = await supabase.storage.from(bucket).remove([p.storage_path]);
        if (sErr) console.warn("storage remove:", sErr.message);
      }
      setProofs((prev) => prev.filter((x) => x.id !== p.id));
      const restoredTotal = Number((reversal as { restored_total?: number } | null)?.restored_total ?? 0);
      toast({
        title: restoredTotal > 0 ? "Pagamento estornado" : "Comprovante excluído",
        description: restoredTotal > 0 ? `${currency(restoredTotal)} voltou para Contas a Receber.` : undefined,
      });
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e?.message ?? "Tente novamente", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const loadOpenReceivables = async (customerId: string) => {
    setSettleOpenList([]);
    setSettleSelected([]);
    if (!customerId) return;
    const { data, error } = await supabase
      .from("accounts_receivable")
      .select("id, description, amount, due_date, status")
      .eq("customer_id", customerId)
      .in("status", ["pendente", "vencido"])
      .order("due_date", { ascending: true });
    if (error) {
      toast({ title: "Erro ao carregar parcelas", description: error.message, variant: "destructive" });
      return;
    }
    setSettleOpenList((data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })));
  };

  const openSettle = (p: Proof) => {
    setSettleTarget(p);
    setSettleCustomerId(p.customer_id ?? "");
    setSettleCustomerQuery("");
    setSettleAmount(p.ai_amount != null ? String(p.ai_amount) : "");
    setSettleDate(new Date(p.created_at).toISOString().slice(0, 10));
    loadOpenReceivables(p.customer_id ?? "");
  };

  const settlePreview = useMemo(() => {
    const amt = Number(settleAmount.replace(",", "."));
    if (!settleTarget || !(amt > 0) || settleOpenList.length === 0 || settleSelected.length === 0) return null;
    const lite: ReceivableLite[] = settleOpenList.map((r) => ({
      id: r.id,
      customer_id: settleCustomerId,
      customer_name: "",
      amount: r.amount,
      due_date: r.due_date,
      status: r.status,
    }));
    return reconcileManualPayment(lite, amt, settleSelected);
  }, [settleTarget, settleAmount, settleOpenList, settleSelected, settleCustomerId]);

  const confirmSettle = async () => {
    if (!settleTarget || !settlePreview || settlePreview.actions.length === 0) return;
    if (!settleDate) {
      toast({ title: "Informe a data do recebimento", variant: "destructive" });
      return;
    }
    setSettleSaving(true);
    try {
      const paidAtIso = new Date(`${settleDate}T12:00:00`).toISOString();
      const settleIds = settlePreview.actions.filter((a) => a.kind === "settle").map((a) => a.receivable_id);
      const reduceActions = settlePreview.actions.filter((a) => a.kind === "reduce");

      if (settleIds.length > 0) {
        const { data: updated, error } = await supabase
          .from("accounts_receivable")
          .update({ status: "pago", paid_at: paidAtIso })
          .in("id", settleIds)
          .select("id");
        if (error) throw error;
        if (!updated || updated.length === 0) {
          throw new Error("Não foi possível atualizar (permissão negada). Verifique sua função de usuário.");
        }
      }
      for (const a of reduceActions) {
        const { error } = await supabase
          .from("accounts_receivable")
          .update({ amount: a.new_amount })
          .eq("id", a.receivable_id);
        if (error) throw error;
      }

      // O vínculo com este comprovante marca a baixa como manual (trigger no banco).
      const links = settlePreview.actions.map((a) => ({
        receivable_id: a.receivable_id,
        proof_id: settleTarget.id,
        amount_paid: a.amount_paid,
      }));
      const { error: linkErr } = await supabase.from("receivable_payments").insert(links);
      if (linkErr) {
        throw new Error(
          `As parcelas foram baixadas, mas o vínculo com o comprovante não foi gravado: ${linkErr.message}. Confira em Contas a Receber antes de repetir a baixa.`,
        );
      }

      const t = settlePreview.totals;
      const leftover = settlePreview.leftovers[0]?.amount;
      toast({
        title: "Baixa aplicada",
        description: `${t.fullySettled} quitada(s) + ${t.partiallyReduced} reduzida(s)${leftover ? ` • sobra ${currency(leftover)}` : ""}`,
      });
      setSettleTarget(null);
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao dar baixa", description: e?.message ?? "Tente novamente", variant: "destructive" });
    } finally {
      setSettleSaving(false);
    }
  };

  const changePendingStatus = async (p: Proof, ignore: boolean) => {
    if (ignore && !confirm('Descartar este comprovante? Ele continua na lista, mas sai de "Aguardando baixa manual".')) return;
    setStatusChangingId(p.id);
    const { error } = await supabase.rpc("set_payment_proof_pending_status", { p_proof_id: p.id, p_ignore: ignore });
    setStatusChangingId(null);
    if (error) {
      toast({ title: "Erro ao alterar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: ignore ? "Comprovante descartado" : "Comprovante reaberto" });
    await load();
  };

  const settleCustomers = useMemo(() => {
    const t = settleCustomerQuery.trim().toLowerCase();
    const list = t
      ? customers.filter((c) => c.name?.toLowerCase().includes(t) || (c.phone ?? "").toLowerCase().includes(t))
      : customers;
    return list.slice(0, 100);
  }, [customers, settleCustomerQuery]);

  const settlementBadge = (p: Proof) => {
    switch (p.settlement_status) {
      case "auto": return <Badge className="bg-emerald-600 hover:bg-emerald-600">Baixa automática</Badge>;
      case "manual": return <Badge className="bg-sky-600 hover:bg-sky-600">Baixa manual</Badge>;
      case "pendente": return <Badge className="bg-amber-500 hover:bg-amber-500 text-black">Aguardando baixa manual</Badge>;
      case "ignorado": return <Badge variant="outline">Descartado</Badge>;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comprovantes"
        description="Comprovantes de pagamento recebidos das clientes — analisados automaticamente pela Mônica"
        actions={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> Novo comprovante</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Cadastrar comprovante manual</DialogTitle>
              </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <Select
                  value={form.customer_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, customer_id: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione uma cliente cadastrada" /></SelectTrigger>
                  <SelectContent>
                    <div className="p-2">
                      <Input
                        placeholder="Buscar por nome ou telefone…"
                        value={customerQuery}
                        onChange={(e) => setCustomerQuery(e.target.value)}
                      />
                    </div>
                    {filteredCustomers.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">Nenhuma cliente encontrada</div>
                    ) : filteredCustomers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.phone ? `— ${c.phone}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Valor (R$)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Data do pagamento</Label>
                  <Input
                    type="date"
                    value={form.payment_date}
                    onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Pagador</Label>
                  <Input
                    placeholder="Nome que aparece no comprovante"
                    value={form.payer_name}
                    onChange={(e) => setForm((f) => ({ ...f, payer_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Banco</Label>
                  <Input
                    placeholder="Ex: Nubank, Itaú…"
                    value={form.bank}
                    onChange={(e) => setForm((f) => ({ ...f, bank: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>ID da transação</Label>
                <Input
                  placeholder="E2E, código PIX, etc."
                  value={form.transaction_id}
                  onChange={(e) => setForm((f) => ({ ...f, transaction_id: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Observações</Label>
                <Textarea
                  rows={3}
                  placeholder="Detalhes adicionais…"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Arquivo (opcional)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  {file && <Upload className="h-4 w-4 text-emerald-600" />}
                </div>
                {file && (
                  <p className="text-xs text-muted-foreground">
                    {file.name} · {(file.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={submitManual} disabled={saving}>
                {saving ? "Salvando…" : "Salvar comprovante"}
              </Button>
            </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />


      <GlassCard className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              type="button"
              size="sm"
              variant={statusFilter === f.value ? "default" : "outline"}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
              {f.value !== "todos" && statusCounts[f.value] != null && (
                <span className="ml-1.5 rounded-full bg-background/20 px-1.5 text-xs">{statusCounts[f.value]}</span>
              )}
            </Button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Buscar por pagador, banco, valor, cliente…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0 sm:border-l sm:border-border/50 sm:pl-3">
            <Switch
              id="only-valid"
              checked={onlyValid}
              onCheckedChange={setOnlyValid}
              aria-label="Mostrar apenas comprovantes válidos"
            />
            <Label htmlFor="only-valid" className="text-sm cursor-pointer whitespace-nowrap">
              Somente comprovantes válidos
            </Label>
            {onlyValid && (
              <Badge className="bg-emerald-600 hover:bg-emerald-600 ml-1">Ativo</Badge>
            )}
          </div>
        </div>
      </GlassCard>

      {loading ? (
        <GlassCard><p className="text-sm text-muted-foreground">Carregando…</p></GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="text-center py-12">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {onlyValid ? "Nenhum comprovante válido encontrado." : "Nenhum comprovante encontrado."}
          </p>
        </GlassCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const url = urls[p.storage_path];
            const isImage = (p.mime_type ?? "").startsWith("image/");
            const isPdf = (p.mime_type ?? "").includes("pdf");
            const noFile = p.storage_path.startsWith("manual/no-file/");
            const allocations = p.receivable_payments ?? [];
            const allocatedTotal = allocations.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
            const displayAmount = allocatedTotal > 0 ? allocatedTotal : p.ai_amount;
            return (
              <GlassCard key={p.id} className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.customer?.name ?? p.ai_payer_name ?? "Cliente desconhecida"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.customer?.phone ?? p.original_filename ?? (noFile ? "sem arquivo" : p.storage_path)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.source === "monica" && (
                      <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" />Mônica</Badge>
                    )}
                    {p.source === "manual" && (
                      <Badge variant="outline">Manual</Badge>
                    )}
                    {p.ai_is_payment_proof === false && (
                      <Badge variant="destructive">Não é comprovante</Badge>
                    )}
                    {settlementBadge(p)}
                  </div>
                </div>

                <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden aspect-video flex items-center justify-center">
                  {url && isImage ? (
                    <img src={url} alt="Comprovante" className="w-full h-full object-contain" />
                  ) : url && isPdf ? (
                    <a href={url} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 text-sm text-primary">
                      <FileText className="h-8 w-8" /> Abrir PDF
                    </a>
                  ) : (
                    <div className="text-xs text-muted-foreground flex flex-col items-center gap-1">
                      <ImageIcon className="h-6 w-6" /> {noFile ? "Sem arquivo anexado" : (p.mime_type ?? "arquivo")}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Valor</div>
                    <div className="font-semibold">{currency(displayAmount)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Banco</div>
                    <div className="font-medium truncate">{p.ai_bank ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Pagador</div>
                    <div className="font-medium truncate">{p.ai_payer_name ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">ID transação</div>
                    <div className="font-mono truncate">{p.ai_transaction_id ?? "—"}</div>
                  </div>
                </div>

                {allocations.length > 0 && (
                  <div className="space-y-1 border-t border-border/50 pt-2 text-xs">
                    <div className="font-medium">Distribuição do pagamento</div>
                    {allocations.map((allocation, index) => (
                      <div key={`${p.id}-${index}`} className="flex items-start justify-between gap-3 text-muted-foreground">
                        <span className="min-w-0 truncate">
                          {allocation.accounts_receivable?.description ?? `Parcela ${index + 1}`}
                        </span>
                        <span className="shrink-0 font-medium text-foreground">
                          {currency(Number(allocation.amount_paid))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {p.settlement_note && p.settlement_status !== "manual" && (
                  <p className={`text-xs border-t border-border/50 pt-2 ${p.settlement_status === "pendente" ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}>
                    {p.settlement_note}
                  </p>
                )}

                {p.ai_summary && (
                  <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">{p.ai_summary}</p>
                )}

                {(p.settlement_status === "pendente" || (p.settlement_status == null && allocations.length === 0)) && (
                  <div className="flex flex-wrap gap-2 border-t border-border/50 pt-2">
                    <Button type="button" size="sm" className="gap-1" onClick={() => openSettle(p)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Dar baixa
                    </Button>
                    {isAdmin && p.settlement_status === "pendente" && (
                      <Button type="button" size="sm" variant="outline" className="gap-1" disabled={statusChangingId === p.id} onClick={() => changePendingStatus(p, true)}>
                        <Ban className="h-3.5 w-3.5" /> Descartar
                      </Button>
                    )}
                  </div>
                )}
                {isAdmin && p.settlement_status === "ignorado" && (
                  <div className="border-t border-border/50 pt-2">
                    <Button type="button" size="sm" variant="outline" className="gap-1" disabled={statusChangingId === p.id} onClick={() => changePendingStatus(p, false)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                    </Button>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                  <span>{new Date(p.created_at).toLocaleString("pt-BR")}</span>
                  <div className="flex items-center gap-3">
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        Abrir <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteProof(p)}
                      disabled={deletingId === p.id}
                      className="h-auto gap-1 p-0 text-destructive hover:text-destructive"
                      aria-label="Excluir comprovante"
                    >
                      <Trash2 className="h-3 w-3" /> {deletingId === p.id ? "Estornando…" : "Excluir"}
                    </Button>
                  </div>
                </div>

              </GlassCard>
            );
          })}
        </div>
      )}

      <Dialog open={!!settleTarget} onOpenChange={(v) => { if (!v) setSettleTarget(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Dar baixa pelo comprovante</DialogTitle>
          </DialogHeader>
          {settleTarget && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs space-y-1">
                <div>Valor lido no comprovante: <span className="font-semibold">{currency(settleTarget.ai_amount)}</span></div>
                {settleTarget.ai_payer_name && <div>Pagador: {settleTarget.ai_payer_name}</div>}
                {settleTarget.settlement_note && <div className="text-amber-600 dark:text-amber-400">{settleTarget.settlement_note}</div>}
              </div>

              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <Select
                  value={settleCustomerId}
                  onValueChange={(v) => { setSettleCustomerId(v); loadOpenReceivables(v); }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione a cliente" /></SelectTrigger>
                  <SelectContent>
                    <div className="p-2">
                      <Input
                        placeholder="Buscar por nome ou telefone…"
                        value={settleCustomerQuery}
                        onChange={(e) => setSettleCustomerQuery(e.target.value)}
                      />
                    </div>
                    {settleCustomerId && !settleCustomers.some((c) => c.id === settleCustomerId) && settleTarget.customer && (
                      <SelectItem value={settleCustomerId}>{settleTarget.customer.name}</SelectItem>
                    )}
                    {settleCustomers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.phone ? `— ${c.phone}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Valor recebido (R$)</Label>
                  <Input inputMode="decimal" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Data do recebimento</Label>
                  <Input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Parcelas em aberto</Label>
                {!settleCustomerId ? (
                  <p className="text-xs text-muted-foreground">Selecione a cliente para ver as parcelas.</p>
                ) : settleOpenList.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma parcela em aberto para esta cliente.</p>
                ) : (
                  <div className="space-y-1 rounded-lg border border-border/50 p-2">
                    {settleOpenList.map((r) => (
                      <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                        <Checkbox
                          checked={settleSelected.includes(r.id)}
                          onCheckedChange={(v) => setSettleSelected((prev) => v ? [...prev, r.id] : prev.filter((id) => id !== r.id))}
                        />
                        <span className="flex-1 min-w-0 truncate">
                          {formatDate(r.due_date)}{r.description ? ` — ${r.description}` : ""}
                          {r.status === "vencido" && <span className="ml-1 text-xs text-destructive">vencida</span>}
                        </span>
                        <span className="font-medium">{currency(r.amount)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {settlePreview && (
                <div className="rounded-lg border border-border/50 p-2 text-xs space-y-1">
                  <div className="font-medium">O que será feito</div>
                  {settlePreview.actions.map((a) => (
                    <div key={a.receivable_id} className="flex justify-between gap-3 text-muted-foreground">
                      <span>{formatDate(a.due_date)} — {a.kind === "settle" ? "quitada" : `reduzida para ${currency(a.new_amount ?? 0)}`}</span>
                      <span className="font-medium text-foreground">{currency(a.amount_paid)}</span>
                    </div>
                  ))}
                  {settlePreview.leftovers[0] && (
                    <div className="text-amber-600 dark:text-amber-400">Sobra sem parcela: {currency(settlePreview.leftovers[0].amount)}</div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettleTarget(null)} disabled={settleSaving}>Cancelar</Button>
            <Button onClick={confirmSettle} disabled={settleSaving || !settlePreview || settlePreview.actions.length === 0}>
              {settleSaving ? "Aplicando…" : "Confirmar baixa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
