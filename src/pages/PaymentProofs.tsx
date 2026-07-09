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
import { FileText, Image as ImageIcon, ExternalLink, Sparkles, Search, Plus, Upload, Trash2 } from "lucide-react";
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
  customer?: { name: string | null; phone: string | null } | null;
}

interface CustomerOpt { id: string; name: string; phone: string | null }

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
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyValid, setOnlyValid] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("payment_proofs_only_valid") === "1";
  });
  const [urls, setUrls] = useState<Record<string, string>>({});

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

  const loadCustomers = async () => {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone")
      .order("name", { ascending: true })
      .limit(500);
    setCustomers((data ?? []) as CustomerOpt[]);
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("payment_proofs")
      .select("id, created_at, storage_path, bucket, original_filename, mime_type, source, customer_id, ai_is_payment_proof, ai_amount, ai_payer_name, ai_bank, ai_transaction_id, ai_summary, customers(name, phone)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: "Erro ao carregar comprovantes", description: error.message, variant: "destructive" });
    } else {
      const rows: Proof[] = (data ?? []).map((r: any) => ({ ...r, customer: r.customers }));
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

  useEffect(() => { load(); loadCustomers(); }, []);

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
    if (!confirm(`Excluir este comprovante${p.customer?.name ? ` de ${p.customer.name}` : ""}? Esta ação não pode ser desfeita.`)) return;
    try {
      const bucket = p.bucket ?? "payment-proofs";
      const noFile = p.storage_path.startsWith("manual/no-file/");
      if (!noFile) {
        const { error: sErr } = await supabase.storage.from(bucket).remove([p.storage_path]);
        if (sErr) console.warn("storage remove:", sErr.message);
      }
      const { error } = await supabase.from("payment_proofs").delete().eq("id", p.id);
      if (error) throw error;
      setProofs((prev) => prev.filter((x) => x.id !== p.id));
      toast({ title: "Comprovante excluído" });
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e?.message ?? "Tente novamente", variant: "destructive" });
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


      <GlassCard>
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
                    {p.ai_is_payment_proof === true && p.source === "monica" && (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">Comprovante</Badge>
                    )}
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
                    <div className="font-semibold">{currency(p.ai_amount)}</div>
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

                {p.ai_summary && (
                  <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">{p.ai_summary}</p>
                )}

                <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                  <span>{new Date(p.created_at).toLocaleString("pt-BR")}</span>
                  <div className="flex items-center gap-3">
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        Abrir <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteProof(p)}
                      className="inline-flex items-center gap-1 text-destructive hover:underline"
                      aria-label="Excluir comprovante"
                    >
                      <Trash2 className="h-3 w-3" /> Excluir
                    </button>
                  </div>
                </div>

              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
