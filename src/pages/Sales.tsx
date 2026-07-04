import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Loader2, Search } from "lucide-react";
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
  customers: { name: string } | null;
  sale_items: { id: string; product_name: string; variant_label: string | null; quantity: number; unit_price: number }[];
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

const fmtBRL = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (s: string) => new Date(s).toLocaleDateString("pt-BR");
const todayISO = () => new Date().toISOString().slice(0, 10);

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
  const [dueDate, setDueDate] = useState<string>(todayISO());
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pickProduct, setPickProduct] = useState<string>("");
  const [pickVariant, setPickVariant] = useState<string>("");
  const [pickQty, setPickQty] = useState<number>(1);

  const load = async () => {
    const [s, p, c] = await Promise.all([
      supabase.from("sales").select("*, customers(name), sale_items(*)").order("sale_date", { ascending: false }).limit(100),
      supabase.from("products").select("id, name, price, cost, product_variants(id, size, color, quantity)").eq("active", true).order("name"),
      fetchAll<Customer>((sb) => sb.from("customers").select("id, name, phone").order("name")),
    ]);
    if (s.error) toast.error(s.error.message);
    setSales((s.data ?? []) as SaleRow[]);
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
    const q = query.trim().toLowerCase();
    return sales.filter((s) => {
      if (from && new Date(s.sale_date) < from) return false;
      if (!q) return true;
      const inCustomer = (s.customers?.name ?? "").toLowerCase().includes(q);
      const inItems = s.sale_items.some((it) =>
        it.product_name.toLowerCase().includes(q),
      );
      return inCustomer || inItems;
    });
  }, [sales, period, query]);

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

            <DialogContent className="glass-card border-white/40 max-w-2xl max-h-[90vh] overflow-y-auto">
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

                <div className="border-t border-white/30 pt-4">
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
                    <div className="mt-3 flex items-center justify-between pt-3 border-t border-white/30">
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
                <div className="text-right">
                  <div className="text-lg font-semibold text-primary">{fmtBRL(Number(s.total))}</div>
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
    </div>
  );
}
