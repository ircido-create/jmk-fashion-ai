import { useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL } from "@/lib/utils";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Loader2, Search, Printer, CreditCard, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useCustomerDebt } from "@/hooks/useCustomerDebt";
import { printReceipt } from "@/lib/receipt";
import { toast } from "sonner";
import { Link } from "react-router-dom";

interface Variant { id: string; size: string | null; color: string | null; quantity: number; }
interface Product {
  id: string; name: string; price: number; cost: number;
  product_variants: Variant[];
}
interface Customer { id: string; name: string; phone: string | null; }
interface SaleRow {
  id: string; sale_date: string; total: number; notes: string | null;
  customer_id: string | null;
  receivable_id: string | null;

  payment_method: string | null;
  installments: number | null;
  customers: { name: string; phone: string | null } | null;
  sale_items: { id: string; product_name: string; variant_label: string | null; variant_id: string | null; quantity: number; unit_price: number }[];
}

interface CartItem {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  maxQty: number;
}

const fmtDate = (s: string) => new Date(s).toLocaleDateString("pt-BR");
const todayISO = () => new Date().toISOString().slice(0, 10);

type PaySimple = "pix" | "dinheiro" | "credito" | "debito" | "link" | "fiado";
const PAY_LABELS: Record<PaySimple, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  credito: "Cartão Crédito",
  debito: "Cartão Débito",
  link: "Link de Pagamento",
  fiado: "Fiado",
};
interface SplitLine { method: PaySimple; amount: number; }

// Extrai a linha "Misto: X R$ 0,00 + Y R$ 0,00" das notes
function parseMistoFromNotes(notes: string | null): SplitLine[] | null {
  if (!notes) return null;
  const m = notes.match(/Misto:\s*(.+?)(?:\s*\|\s*|$)/i);
  if (!m) return null;
  const parts = m[1].split("+").map((s) => s.trim());
  const out: SplitLine[] = [];
  for (const p of parts) {
    const mm = p.match(/^(.+?)\s+R\$\s*([\d.,]+)$/);
    if (!mm) continue;
    const label = mm[1].trim();
    const key = (Object.keys(PAY_LABELS) as PaySimple[]).find((k) => PAY_LABELS[k].toLowerCase() === label.toLowerCase());
    if (!key) continue;
    const val = Number(mm[2].replace(/\./g, "").replace(",", "."));
    if (!isFinite(val)) continue;
    out.push({ method: key, amount: val });
  }
  return out.length >= 2 ? out : null;
}

type PeriodFilter = "week" | "today" | "month" | "all";

export default function Sales() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [period, setPeriod] = useState<PeriodFilter>("week");
  const [query, setQuery] = useState("");

  // Form state
  const [customerId, setCustomerId] = useState<string>("");
  const { debt: customerDebt, loading: debtLoading } = useCustomerDebt(customerId || null);
  const [dueDate, setDueDate] = useState<string>(todayISO());
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pickProduct, setPickProduct] = useState<string>("");
  const [pickVariant, setPickVariant] = useState<string>("");
  const [pickQty, setPickQty] = useState<number>(1);

  // Editar forma de pagamento de venda finalizada
  const [payEdit, setPayEdit] = useState<SaleRow | null>(null);
  const [payMethod, setPayMethod] = useState<PaySimple>("dinheiro");
  const [payInstallments, setPayInstallments] = useState<number>(1);
  const [paySplitMode, setPaySplitMode] = useState(false);
  const [paySplits, setPaySplits] = useState<SplitLine[]>([]);
  const [payFiadoDueDate, setPayFiadoDueDate] = useState<string>(todayISO());
  const [savingPay, setSavingPay] = useState(false);

  // Contas a receber já existentes desta venda
  type RecRow = { id: string; amount: number; description?: string | null; due_date?: string | null };
  const [payExistingOpen, setPayExistingOpen] = useState<RecRow[]>([]);
  const [payExistingPaid, setPayExistingPaid] = useState<RecRow[]>([]);
  const [payLoadingExisting, setPayLoadingExisting] = useState(false);

  const fetchSaleReceivables = async (s: SaleRow) => {
    const short = s.id.slice(0, 8).toUpperCase();
    const orFilter = [`sale_id.eq.${s.id}`, `description.ilike.%venda ${short}%`]
      .concat(s.receivable_id ? [`id.eq.${s.receivable_id}`] : [])
      .join(",");
    const { data, error } = await supabase
      .from("accounts_receivable")
      .select("id, amount, status, description, due_date")
      .or(orFilter);
    if (error) throw error;
    const rows = data ?? [];
    const ids = rows.map((r) => r.id);
    let paidIds = new Set<string>();
    if (ids.length) {
      const { data: pays } = await supabase
        .from("receivable_payments")
        .select("receivable_id")
        .in("receivable_id", ids);
      paidIds = new Set((pays ?? []).map((p) => p.receivable_id as string));
    }
    const open: RecRow[] = [];
    const paid: RecRow[] = [];
    for (const r of rows) {
      const isPaid = r.status === "pago" || paidIds.has(r.id);
      (isPaid ? paid : open).push({
        id: r.id,
        amount: Number(r.amount),
        description: (r as any).description ?? null,
        due_date: (r as any).due_date ?? null,
      });
    }
    return { open, paid };
  };

  const loadSaleReceivables = async (s: SaleRow) => {
    setPayLoadingExisting(true);
    setPayExistingOpen([]);
    setPayExistingPaid([]);
    try {
      const { open, paid } = await fetchSaleReceivables(s);
      setPayExistingOpen(open);
      setPayExistingPaid(paid);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao carregar contas da venda");
    } finally {
      setPayLoadingExisting(false);
    }
  };

  // Excluir venda (estorna estoque)
  const [delSale, setDelSale] = useState<SaleRow | null>(null);
  const [delOpenRecs, setDelOpenRecs] = useState<RecRow[]>([]);
  const [delPaidRecs, setDelPaidRecs] = useState<RecRow[]>([]);
  const [delLoading, setDelLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openDeleteSale = async (s: SaleRow) => {
    setDelSale(s);
    setDelOpenRecs([]);
    setDelPaidRecs([]);
    setDelLoading(true);
    try {
      const { open, paid } = await fetchSaleReceivables(s);
      setDelOpenRecs(open);
      setDelPaidRecs(paid);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao verificar pagamentos da venda");
    } finally {
      setDelLoading(false);
    }
  };

  const confirmDeleteSale = async () => {
    if (!delSale || delPaidRecs.length > 0) return;
    setDeleting(true);
    try {
      let restored = 0;
      for (const it of delSale.sale_items) {
        if (!it.variant_id) continue;
        const { error } = await supabase.rpc("increment_variant_stock", {
          variant_id: it.variant_id,
          qty: it.quantity,
        });
        if (error) throw error;
        restored += it.quantity;
      }

      if (delOpenRecs.length) {
        const { error } = await supabase
          .from("accounts_receivable")
          .delete()
          .in("id", delOpenRecs.map((r) => r.id));
        if (error) throw error;
      }

      const { error: itErr } = await supabase.from("sale_items").delete().eq("sale_id", delSale.id);
      if (itErr) throw itErr;
      const { error: sErr } = await supabase.from("sales").delete().eq("id", delSale.id);
      if (sErr) throw sErr;

      toast.success(
        `Venda excluída · ${restored} peça(s) estornada(s) ao estoque${delOpenRecs.length ? ` · ${delOpenRecs.length} parcela(s) removida(s)` : ""}`
      );
      setDelSale(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao excluir venda");
    } finally {
      setDeleting(false);
    }
  };


  const openPayEdit = (s: SaleRow) => {
    setPayEdit(s);
    const isMisto = (s.payment_method ?? "") === "misto";
    setPaySplitMode(isMisto);
    setPayMethod(isMisto ? "dinheiro" : ((s.payment_method as PaySimple) ?? "dinheiro"));
    setPayInstallments(s.installments ?? 1);
    setPayFiadoDueDate(todayISO());
    if (isMisto) {
      const parsed = parseMistoFromNotes(s.notes);
      if (parsed) setPaySplits(parsed);
      else setPaySplits([
        { method: "pix", amount: Math.round(Number(s.total) * 100) / 200 },
        { method: "dinheiro", amount: Math.round(Number(s.total) * 100) / 200 },
      ]);
    } else {
      setPaySplits([
        { method: "pix", amount: Math.round(Number(s.total) * 100) / 200 },
        { method: "dinheiro", amount: Math.round(Number(s.total) * 100) / 200 },
      ]);
    }
    loadSaleReceivables(s);
  };


  const splitsSum = useMemo(
    () => paySplits.reduce((a, b) => a + (Number(b.amount) || 0), 0),
    [paySplits],
  );

  const savePayEdit = async () => {
    if (!payEdit) return;
    const total = Number(payEdit.total);

    if (paySplitMode) {
      if (paySplits.length < 2) { toast.error("Adicione pelo menos 2 formas de pagamento"); return; }
      if (Math.abs(splitsSum - total) > 0.01) {
        toast.error(`Soma (${fmtBRL(splitsSum)}) difere do total (${fmtBRL(total)})`);
        return;
      }
    }

    setSavingPay(true);
    try {
      let newMethod: string;
      let newInstallments = 1;
      let newNotes = (payEdit.notes ?? "").replace(/\s*\|\s*Misto:[^|]*/gi, "").replace(/^Misto:[^|]*\|?\s*/i, "").trim();

      if (paySplitMode) {
        newMethod = "misto";
        const line = "Misto: " + paySplits
          .map((s) => `${PAY_LABELS[s.method]} ${fmtBRL(s.amount)}`)
          .join(" + ");
        newNotes = [newNotes, line].filter(Boolean).join(" | ");
      } else {
        newMethod = payMethod;
        newInstallments = (payMethod === "credito" || payMethod === "fiado") ? Math.max(1, payInstallments) : 1;
      }

      // 1) Remove as contas a receber EM ABERTO desta venda (substitui, não soma)
      const openIds = payExistingOpen.map((r) => r.id);
      if (openIds.length) {
        const { error: dErr } = await supabase
          .from("accounts_receivable")
          .delete()
          .in("id", openIds);
        if (dErr) throw dErr;
      }

      const paidSum = payExistingPaid.reduce((a, b) => a + b.amount, 0);

      // 2) Calcula o valor que deve virar carteira (fiado)
      const fiadoTarget = paySplitMode
        ? paySplits.filter((s) => s.method === "fiado").reduce((a, b) => a + b.amount, 0)
        : (payMethod === "fiado" ? total : 0);
      const remaining = Math.round(Math.max(0, fiadoTarget - paidSum) * 100) / 100;

      let newReceivableId: string | null = null;

      if (remaining > 0 && payEdit.customer_id) {
        const shortId = payEdit.id.slice(0, 8).toUpperCase();
        const totalParts = paySplitMode ? 1 : Math.max(1, newInstallments);
        const parcela = Math.round((remaining / totalParts) * 100) / 100;
        const base = new Date(payFiadoDueDate + "T00:00:00");
        const records = Array.from({ length: totalParts }).map((_, i) => {
          const due = new Date(base); due.setMonth(base.getMonth() + i);
          const valor = i === totalParts - 1
            ? Math.round((remaining - parcela * (totalParts - 1)) * 100) / 100
            : parcela;
          return {
            customer_id: payEdit.customer_id!,
            sale_id: payEdit.id,
            amount: valor,
            due_date: due.toISOString().slice(0, 10),
            description: paySplitMode
              ? `Pagamento misto — parte na carteira — venda ${shortId}`
              : (totalParts === 1
                ? `Fiado — venda ${shortId}`
                : `Fiado (${i + 1}/${totalParts}) — venda ${shortId}`),
            status: "pendente" as const,
          };
        });
        const { data: inserted, error: rErr } = await supabase
          .from("accounts_receivable")
          .insert(records)
          .select("id");
        if (rErr) throw rErr;
        newReceivableId = inserted?.[0]?.id ?? null;
      }

      // 3) Atualiza a venda (inclui vínculo com a cobrança gerada)
      const { error } = await supabase
        .from("sales")
        .update({
          payment_method: newMethod,
          installments: newInstallments,
          notes: newNotes || null,
          receivable_id: newReceivableId,
        })
        .eq("id", payEdit.id);
      if (error) throw error;

      toast.success(
        openIds.length
          ? `Forma de pagamento atualizada — ${openIds.length} cobrança(s) em aberto substituída(s)`
          : "Forma de pagamento atualizada",
      );
      setPayEdit(null);
      load();

    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao atualizar");
    } finally {
      setSavingPay(false);
    }
  };


  const load = async () => {
    const [s, p, c] = await Promise.all([
      supabase.from("sales").select("*, customers(name, phone), sale_items(*)").order("sale_date", { ascending: false }).limit(100),
      supabase.from("products").select("id, name, price, cost, product_variants(id, size, color, quantity)").eq("active", true).order("name"),
      fetchAll<Customer>((sb) => sb.from("customers").select("id, name, phone").order("name")),
    ]);
    if (s.error) toast.error(s.error.message);
    setSales((s.data ?? []) as unknown as SaleRow[]);
    setProducts((p.data ?? []) as Product[]);
    setCustomers(c as Customer[]);
  };

  useEffect(() => { load(); }, []);

  const selectedProduct = products.find((p) => p.id === pickProduct);
  const selectedVariant = selectedProduct?.product_variants.find((v) => v.id === pickVariant);

  const addToCart = () => {
    if (!selectedProduct) { toast.error("Escolha o produto"); return; }
    const variant = selectedVariant;
    const max = variant ? variant.quantity : 999;
    if (pickQty < 1 || pickQty > max) { toast.error(`Quantidade inválida (estoque: ${max})`); return; }
    const variantLabel = variant ? [variant.size, variant.color].filter(Boolean).join(" / ") : "";
    setCart((c) => [
      ...c,
      {
        productId: selectedProduct.id,
        variantId: variant?.id ?? null,
        productName: selectedProduct.name,
        variantLabel,
        quantity: pickQty,
        unitPrice: Number(selectedProduct.price),
        unitCost: Number(selectedProduct.cost),
        maxQty: max,
      },
    ]);
    setPickProduct(""); setPickVariant(""); setPickQty(1);
  };

  const total = useMemo(() => cart.reduce((s, it) => s + it.unitPrice * it.quantity, 0), [cart]);

  const debouncedQuery = useDebouncedValue(query, 300);
  const filteredSales = useMemo(() => {
    const now = new Date();
    let from: Date | null = null;
    if (period === "today") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === "week") {
      from = new Date(now);
      from.setDate(now.getDate() - 7);
    } else if (period === "month") {
      from = new Date(now);
      from.setDate(now.getDate() - 30);
    }
    const q = debouncedQuery.trim().toLowerCase();
    return sales.filter((s) => {
      if (from && new Date(s.sale_date) < from) return false;
      if (!q) return true;
      const inCustomer = (s.customers?.name ?? "").toLowerCase().includes(q);
      const inItems = s.sale_items.some((it) =>
        it.product_name.toLowerCase().includes(q),
      );
      return inCustomer || inItems;
    });
  }, [sales, period, debouncedQuery]);

  const periodTotal = useMemo(
    () => filteredSales.reduce((s, x) => s + Number(x.total || 0), 0),
    [filteredSales],
  );

  const reset = () => {
    setCustomerId(""); setDueDate(todayISO()); setNotes(""); setCart([]);
    setPickProduct(""); setPickVariant(""); setPickQty(1);
  };

  const save = async () => {
    if (cart.length === 0) { toast.error("Adicione ao menos 1 item"); return; }
    if (!customerId) { toast.error("Selecione o cliente"); return; }

    setSaving(true);
    try {
      // 1) Cria conta a receber
      const { data: rec, error: recErr } = await supabase
        .from("accounts_receivable")
        .insert({
          customer_id: customerId,
          amount: total,
          due_date: dueDate,
          description: `Venda — ${cart.length} item(ns)`,
          status: "pendente",
        })
        .select()
        .single();
      if (recErr) throw recErr;

      // 2) Cria venda
      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .insert({
          customer_id: customerId,
          receivable_id: rec.id,
          total,
          notes: notes || null,
          sale_date: new Date().toISOString(),
        })
        .select()
        .single();
      if (saleErr) throw saleErr;

      // 3) Itens
      const items = cart.map((it) => ({
        sale_id: sale.id,
        product_id: it.productId,
        variant_id: it.variantId,
        product_name: it.productName,
        variant_label: it.variantLabel || null,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        unit_cost: it.unitCost,
      }));
      const { error: itErr } = await supabase.from("sale_items").insert(items);
      if (itErr) throw itErr;

      // 4) Decrementa estoque (atômico via RPC, a partir do valor atual do banco)
      for (const it of cart) {
        if (it.variantId) {
          await supabase.rpc("decrement_variant_stock", { variant_id: it.variantId, qty: it.quantity });
        }
      }

      toast.success("Venda registrada");
      setOpen(false); reset(); load();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || "desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Vendas"
        description={`${sales.length} venda(s) registradas`}
        actions={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary text-primary-foreground shadow-glow rounded-xl">
                <Plus className="h-4 w-4 mr-1" /> Nova venda
              </Button>
            </DialogTrigger>

            <DialogContent className="glass-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Nova venda</DialogTitle></DialogHeader>

              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Cliente</Label>
                    <Select value={customerId} onValueChange={setCustomerId}>
                      <SelectTrigger className="glass-input mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Vencimento</Label>
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="glass-input mt-1" />
                  </div>
                </div>

                <div
                  aria-live="polite"
                  className="flex items-center justify-between rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur px-3 py-2"
                >
                  <span className="text-xs text-muted-foreground">Dívida Total</span>
                  {!customerId ? (
                    <span className="text-xs text-muted-foreground">Selecione um cliente</span>
                  ) : debtLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (customerDebt ?? 0) > 0 ? (
                    <span className="text-base font-bold text-destructive">{fmtBRL(customerDebt ?? 0)}</span>
                  ) : (
                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Nenhuma dívida pendente</span>
                  )}
                </div>




                <div className="border-t border-border pt-4">
                  <Label className="text-sm font-semibold">Adicionar produtos</Label>
                  <div className="grid sm:grid-cols-[1fr_1fr_90px_auto] gap-2 mt-2">
                    <Select value={pickProduct} onValueChange={(v) => { setPickProduct(v); setPickVariant(""); }}>
                      <SelectTrigger className="glass-input"><SelectValue placeholder="Produto" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name} — {fmtBRL(Number(p.price))}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={pickVariant} onValueChange={setPickVariant} disabled={!selectedProduct}>
                      <SelectTrigger className="glass-input">
                        <SelectValue placeholder={selectedProduct?.product_variants.length ? "Variação" : "Sem variações"} />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedProduct?.product_variants.map((v) => (
                          <SelectItem key={v.id} value={v.id} disabled={v.quantity <= 0}>
                            {[v.size, v.color].filter(Boolean).join(" / ") || "Única"} — estoque {v.quantity}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input type="number" min={1} value={pickQty} onChange={(e) => setPickQty(Number(e.target.value))} className="glass-input" />
                    <Button type="button" onClick={addToCart} variant="outline">+</Button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {cart.map((it, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-white/40 dark:bg-white/5">
                        <div className="text-sm min-w-0">
                          <div className="font-medium truncate">{it.quantity}× {it.productName}</div>
                          {it.variantLabel && <div className="text-xs text-muted-foreground">{it.variantLabel}</div>}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-sm font-semibold">{fmtBRL(it.unitPrice * it.quantity)}</div>
                          <Button size="icon" variant="ghost" onClick={() => setCart((c) => c.filter((_, idx) => idx !== i))} aria-label="Remover item">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {cart.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">Nenhum item ainda.</p>}
                  </div>

                  {cart.length > 0 && (
                    <div className="mt-3 flex items-center justify-between pt-3 border-t border-border">
                      <span className="text-sm text-muted-foreground">Total</span>
                      <span className="text-xl font-bold gradient-text">{fmtBRL(total)}</span>
                    </div>
                  )}
                </div>

                <div>
                  <Label>Observações</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="glass-input mt-1" rows={2} />
                </div>

                <Button onClick={save} disabled={saving} className="w-full bg-gradient-primary text-primary-foreground rounded-xl">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar venda"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <GlassCard className="mb-3 p-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="flex gap-1 flex-wrap">
            {([
              { v: "today", label: "Hoje" },
              { v: "week", label: "Últimos 7 dias" },
              { v: "month", label: "Últimos 30 dias" },
              { v: "all", label: "Todas" },
            ] as { v: PeriodFilter; label: string }[]).map((opt) => (
              <Button
                key={opt.v}
                size="sm"
                variant={period === opt.v ? "default" : "outline"}
                onClick={() => setPeriod(opt.v)}
                className={period === opt.v ? "bg-gradient-primary text-primary-foreground" : ""}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente ou produto…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="glass-input pl-9"
            />
          </div>
          <div className="text-sm text-muted-foreground sm:ml-auto whitespace-nowrap">
            {filteredSales.length} venda(s) · <span className="font-semibold text-primary">{fmtBRL(periodTotal)}</span>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="space-y-3">
          {filteredSales.map((s) => (
            <div key={s.id} className="p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.customer_id ? (
                      <Link to={`/clientes/${s.customer_id}`} className="font-medium hover:underline">
                        {s.customers?.name ?? "Cliente"}
                      </Link>
                    ) : <span className="font-medium">Sem cliente</span>}
                    <span className="text-xs text-muted-foreground">{fmtDate(s.sale_date)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {s.sale_items.map((it) => `${it.quantity}× ${it.product_name}`).join(" • ")}
                  </div>
                </div>
                <div className="text-right flex flex-col items-end gap-1">
                  <div className="text-lg font-semibold text-primary">{fmtBRL(Number(s.total))}</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const ok = printReceipt({
                        number: s.id.slice(0, 8).toUpperCase(),
                        date: new Date(s.sale_date),
                        customer: s.customers
                          ? { name: s.customers.name, phone: s.customers.phone }
                          : null,
                        items: s.sale_items.map((it) => ({
                          productName: it.product_name,
                          variantLabel: it.variant_label,
                          quantity: it.quantity,
                          unitPrice: Number(it.unit_price),
                        })),
                        subtotal: Number(s.total),
                        payment: (s.payment_method ?? "dinheiro") as any,
                        installments: s.installments ?? 1,
                        reprint: true,
                      });
                      if (!ok) toast.error("Bloqueador de pop-up impediu a impressão");
                    }}
                  >
                    <Printer className="h-3.5 w-3.5 mr-1" /> Reimprimir cupom
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openPayEdit(s)}>
                    <CreditCard className="h-3.5 w-3.5 mr-1" /> Forma de pagamento
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/40 hover:bg-destructive/10"
                    onClick={() => openDeleteSale(s)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir venda
                  </Button>

                  {s.payment_method && (
                    <span className="text-[11px] text-muted-foreground">
                      {s.payment_method}
                      {(s.installments ?? 1) > 1 ? ` · ${s.installments}x` : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filteredSales.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhuma venda encontrada
            </div>
          )}
        </div>
      </GlassCard>

      <Dialog open={!!payEdit} onOpenChange={(o) => !o && setPayEdit(null)}>
        <DialogContent className="glass-card border-border max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Alterar forma de pagamento</DialogTitle>
          </DialogHeader>
          {payEdit && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-white/40 dark:bg-white/5 px-3 py-2">
                <span className="text-xs text-muted-foreground">Total da venda</span>
                <span className="text-base font-bold">{fmtBRL(Number(payEdit.total))}</span>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="split-mode">Pagamento misto (várias formas)</Label>
                <Switch id="split-mode" checked={paySplitMode} onCheckedChange={setPaySplitMode} />
              </div>

              {!paySplitMode && (
                <>
                  <div>
                    <Label>Método</Label>
                    <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaySimple)}>
                      <SelectTrigger className="glass-input mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PAY_LABELS) as PaySimple[]).map((k) => (
                          <SelectItem key={k} value={k}>{PAY_LABELS[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {(payMethod === "credito" || payMethod === "fiado") && (
                    <div>
                      <Label>Parcelas</Label>
                      <Input
                        type="number"
                        min={1}
                        max={12}
                        value={payInstallments}
                        onChange={(e) => setPayInstallments(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                        className="glass-input mt-1"
                      />
                    </div>
                  )}
                  {payMethod === "fiado" && (
                    <div>
                      <Label>Vencimento (1ª parcela)</Label>
                      <Input
                        type="date"
                        value={payFiadoDueDate}
                        onChange={(e) => setPayFiadoDueDate(e.target.value)}
                        className="glass-input mt-1"
                      />
                    </div>
                  )}
                </>
              )}

              {paySplitMode && (
                <div className="space-y-2">
                  <Label>Formas de pagamento</Label>
                  {paySplits.map((sp, i) => (
                    <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-2">
                      <Select
                        value={sp.method}
                        onValueChange={(v) => setPaySplits((prev) => prev.map((x, idx) => idx === i ? { ...x, method: v as PaySimple } : x))}
                      >
                        <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(PAY_LABELS) as PaySimple[]).map((k) => (
                            <SelectItem key={k} value={k}>{PAY_LABELS[k]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        value={sp.amount}
                        onChange={(e) => setPaySplits((prev) => prev.map((x, idx) => idx === i ? { ...x, amount: Number(e.target.value) || 0 } : x))}
                        className="glass-input"
                      />
                      <Button size="icon" variant="ghost" onClick={() => setPaySplits((prev) => prev.filter((_, idx) => idx !== i))} disabled={paySplits.length <= 2}>
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPaySplits((prev) => [...prev, { method: "pix", amount: 0 }])}
                  >
                    + Adicionar forma
                  </Button>
                  <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${Math.abs(splitsSum - Number(payEdit.total)) > 0.01 ? "bg-destructive/10" : "bg-emerald-500/10"}`}>
                    <span className="text-xs">Soma das formas</span>
                    <span className={`text-sm font-semibold ${Math.abs(splitsSum - Number(payEdit.total)) > 0.01 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {fmtBRL(splitsSum)} / {fmtBRL(Number(payEdit.total))}
                    </span>
                  </div>
                  {paySplits.some((s) => s.method === "fiado") && (
                    <div>
                      <Label>Vencimento (parte fiado)</Label>
                      <Input
                        type="date"
                        value={payFiadoDueDate}
                        onChange={(e) => setPayFiadoDueDate(e.target.value)}
                        className="glass-input mt-1"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl bg-white/40 dark:bg-white/5 px-3 py-2 text-xs text-muted-foreground space-y-1">
                {payLoadingExisting ? (
                  <span>Verificando cobranças desta venda...</span>
                ) : (
                  <>
                    <p>
                      Esta é uma <b>alteração</b> da mesma venda: as cobranças em aberto desta venda
                      {payExistingOpen.length > 0
                        ? ` (${payExistingOpen.length} — ${fmtBRL(payExistingOpen.reduce((a, b) => a + b.amount, 0))})`
                        : ""} serão <b>substituídas</b>, não somadas.
                    </p>
                    {payExistingPaid.length > 0 && (
                      <p className="text-emerald-600 dark:text-emerald-400">
                        {payExistingPaid.length} parcela(s) já paga(s) ({fmtBRL(payExistingPaid.reduce((a, b) => a + b.amount, 0))}) serão mantidas e descontadas do novo saldo.
                      </p>
                    )}
                  </>
                )}
              </div>

            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayEdit(null)}>Cancelar</Button>
            <Button onClick={savePayEdit} disabled={savingPay} className="bg-gradient-primary text-primary-foreground">
              {savingPay ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!delSale} onOpenChange={(o) => !o && !deleting && setDelSale(null)}>
        <DialogContent className="glass-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir venda</DialogTitle>
          </DialogHeader>
          {delSale && (
            <div className="space-y-3 text-sm">
              <div className="p-3 rounded-xl bg-white/40 dark:bg-white/5">
                <div className="font-medium">{delSale.customers?.name ?? "Sem cliente"}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtDate(delSale.sale_date)} · <span className="font-semibold text-primary">{fmtBRL(Number(delSale.total))}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {delSale.sale_items.map((it) => `${it.quantity}× ${it.product_name}`).join(" • ")}
                </div>
              </div>

              {delLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Verificando pagamentos...
                </div>
              ) : delPaidRecs.length > 0 ? (
                <p className="text-destructive font-medium">
                  Não é possível excluir: existem pagamentos registrados para esta venda ({delPaidRecs.length} parcela(s) — {fmtBRL(delPaidRecs.reduce((a, b) => a + b.amount, 0))}). Estorne os pagamentos antes.
                </p>
              ) : (
                <div className="space-y-1 text-muted-foreground">
                  <p>Esta ação irá:</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    <li>
                      Estornar {delSale.sale_items.filter((it) => it.variant_id).reduce((a, b) => a + b.quantity, 0)} peça(s) ao estoque
                    </li>
                    {delSale.sale_items.some((it) => !it.variant_id) && (
                      <li>Itens avulsos (sem variação) não geram estorno de estoque</li>
                    )}
                    {delOpenRecs.length > 0 && (
                      <li>
                        Remover {delOpenRecs.length} parcela(s) em aberto ({fmtBRL(delOpenRecs.reduce((a, b) => a + b.amount, 0))})
                      </li>
                    )}
                    <li>Apagar a venda e seus itens (não pode ser desfeito)</li>
                  </ul>
                  {delOpenRecs.length > 0 && (
                    <div className="mt-2 p-2 rounded-lg bg-white/40 dark:bg-white/5 space-y-0.5 max-h-40 overflow-auto">
                      {delOpenRecs.map((r) => (
                        <div key={r.id} className="flex justify-between text-xs">
                          <span className="truncate mr-2">{r.description ?? "Parcela"}{r.due_date ? ` · venc. ${fmtDate(r.due_date + "T00:00:00")}` : ""}</span>
                          <span className="font-medium">{fmtBRL(r.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelSale(null)} disabled={deleting}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteSale}
              disabled={deleting || delLoading || delPaidRecs.length > 0}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Excluir venda"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



    </div>
  );
}
