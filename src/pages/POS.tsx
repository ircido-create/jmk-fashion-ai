import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Minus, Trash2, Search, ShoppingCart, Loader2, Printer, ChevronRight, ChevronLeft, Receipt, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useCustomerDebt } from "@/hooks/useCustomerDebt";

type PaymentMethod = "dinheiro" | "debito" | "credito" | "pix" | "fiado";
interface SplitEntry { method: PaymentMethod; amount: number; }

interface Variant { id: string; size: string | null; color: string | null; quantity: number; sku: string | null; }
interface Product {
  id: string; name: string; sku: string | null; price: number; cost: number; image_url: string | null;
  product_variants: Variant[];
}
interface Customer { id: string; name: string; nickname: string | null; phone: string | null; }

interface CartItem {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  maxQty: number;
  isAvulso?: boolean;
}

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const todayISO = () => new Date().toISOString().slice(0, 10);
const addMonths = (date: Date, n: number) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
};

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  debito: "Cartão de Débito",
  credito: "Cartão de Crédito",
  pix: "PIX",
  fiado: "Carteira",
  misto: "Pagamento Misto",
};

type Step = 1 | 2 | 3;

export default function POS() {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [step, setStep] = useState<Step>(1);

  // Step 1 — variant picker
  const [variantPickFor, setVariantPickFor] = useState<Product | null>(null);
  const [pickVariantId, setPickVariantId] = useState<string>("");
  const [pickQty, setPickQty] = useState<number>(1);

  // Step 1 — produto avulso (não cadastrado)
  const [avulsoOpen, setAvulsoOpen] = useState(false);
  const [avulsoName, setAvulsoName] = useState("");
  const [avulsoPrice, setAvulsoPrice] = useState<string>("");
  const [avulsoQty, setAvulsoQty] = useState<number>(1);

  // Step 2
  const [customerId, setCustomerId] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState("");
  const { debt: customerDebt, loading: debtLoading } = useCustomerDebt(customerId || null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // Step 3
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("dinheiro");
  const [installments, setInstallments] = useState<number>(1);
  const [generateReceivables, setGenerateReceivables] = useState<boolean>(true);
  const [cashReceived, setCashReceived] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [firstDueDate, setFirstDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });

  // Pagamento misto (várias formas na mesma venda)
  const [splitMode, setSplitMode] = useState<boolean>(false);
  const [splits, setSplits] = useState<SplitEntry[]>([]);
  const [splitMethod, setSplitMethod] = useState<PaymentMethod>("pix");
  const [splitAmount, setSplitAmount] = useState<string>("");

  // Saving + receipt
  const [saving, setSaving] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receipt, setReceipt] = useState<{
    number: string;
    date: Date;
    customer: Customer | null;
    items: CartItem[];
    subtotal: number;
    payment: PaymentMethod | "misto";
    installments: number;
    cashReceived: number;
    change: number;
    splits?: SplitEntry[];
  } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const [p, c] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, sku, price, cost, image_url, product_variants(id, size, color, quantity, sku)")
        .eq("active", true)
        .order("name"),
      fetchAll<Customer>((sb) => sb.from("customers").select("id, name, nickname, phone").order("name")),
    ]);
    setProducts((p.data ?? []) as Product[]);
    setCustomers(c as Customer[]);
  };

  useEffect(() => {
    load();
  }, []);

  // ---------- Cart logic ----------
  const total = useMemo(() => cart.reduce((s, it) => s + it.unitPrice * it.quantity, 0), [cart]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q) ||
          p.product_variants.some((v) => (v.sku ?? "").toLowerCase().includes(q)),
      )
      .slice(0, 60);
  }, [products, search]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 50);
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.nickname ?? "").toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q))
      .slice(0, 50);
  }, [customers, customerSearch]);

  const addProductToCart = (product: Product) => {
    const variants = product.product_variants ?? [];
    if (variants.length === 0) {
      // No variants — add directly
      pushItem({
        productId: product.id,
        variantId: null,
        productName: product.name,
        variantLabel: "",
        sku: product.sku,
        quantity: 1,
        unitPrice: Number(product.price),
        unitCost: Number(product.cost),
        maxQty: 9999,
      });
      return;
    }
    const inStock = variants.filter((v) => v.quantity > 0);
    if (inStock.length === 1) {
      const v = inStock[0];
      pushItem({
        productId: product.id,
        variantId: v.id,
        productName: product.name,
        variantLabel: [v.size, v.color].filter(Boolean).join(" / "),
        sku: v.sku ?? product.sku,
        quantity: 1,
        unitPrice: Number(product.price),
        unitCost: Number(product.cost),
        maxQty: v.quantity,
      });
      return;
    }
    setVariantPickFor(product);
    setPickVariantId("");
    setPickQty(1);
  };

  const confirmVariant = () => {
    if (!variantPickFor || !pickVariantId) {
      toast.error("Selecione a variação");
      return;
    }
    const v = variantPickFor.product_variants.find((x) => x.id === pickVariantId)!;
    if (pickQty < 1 || pickQty > v.quantity) {
      toast.error(`Quantidade inválida (estoque: ${v.quantity})`);
      return;
    }
    pushItem({
      productId: variantPickFor.id,
      variantId: v.id,
      productName: variantPickFor.name,
      variantLabel: [v.size, v.color].filter(Boolean).join(" / "),
      sku: v.sku ?? variantPickFor.sku,
      quantity: pickQty,
      unitPrice: Number(variantPickFor.price),
      unitCost: Number(variantPickFor.cost),
      maxQty: v.quantity,
    });
    setVariantPickFor(null);
  };

  const pushItem = (item: CartItem) => {
    setCart((c) => {
      const idx = c.findIndex(
        (x) => x.productId === item.productId && x.variantId === item.variantId,
      );
      if (idx >= 0) {
        const next = [...c];
        const merged = { ...next[idx], quantity: Math.min(next[idx].maxQty, next[idx].quantity + item.quantity) };
        next[idx] = merged;
        return next;
      }
      return [...c, item];
    });
  };

  const updateQty = (idx: number, delta: number) => {
    setCart((c) => {
      const next = [...c];
      const item = { ...next[idx] };
      const q = item.quantity + delta;
      if (q < 1) {
        if (typeof window !== "undefined" && window.confirm(`Remover "${item.productName}" do carrinho?`)) {
          return c.filter((_, i) => i !== idx);
        }
        return c;
      }
      if (q > item.maxQty) {
        toast.error(`Apenas ${item.maxQty} unidade(s) em estoque`);
        return c;
      }
      item.quantity = q;
      next[idx] = item;
      return next;
    });
  };

  const setQtyExact = (idx: number, raw: string) => {
    const parsed = Math.floor(Number(raw));
    setCart((c) => {
      const next = [...c];
      const item = { ...next[idx] };
      if (!Number.isFinite(parsed) || parsed < 1) return c;
      if (parsed > item.maxQty) {
        toast.error(`Apenas ${item.maxQty} unidade(s) em estoque`);
        item.quantity = item.maxQty;
      } else {
        item.quantity = parsed;
      }
      next[idx] = item;
      return next;
    });
  };

  const setUnitPrice = (idx: number, raw: string) => {
    const normalized = String(raw).replace(",", ".");
    const parsed = Number(normalized);
    setCart((c) => {
      if (!Number.isFinite(parsed) || parsed < 0) return c;
      const next = [...c];
      next[idx] = { ...next[idx], unitPrice: Math.round(parsed * 100) / 100 };
      return next;
    });
  };

  const removeItem = (idx: number) => setCart((c) => c.filter((_, i) => i !== idx));

  const resetAll = () => {
    setCart([]);
    setStep(1);
    setCustomerId("");
    setCustomerSearch("");
    setPaymentMethod("dinheiro");
    setInstallments(1);
    setGenerateReceivables(true);
    setCashReceived("");
    setNotes("");
    setSplitMode(false);
    setSplits([]);
    setSplitMethod("pix");
    setSplitAmount("");
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setFirstDueDate(d.toISOString().slice(0, 10));
  };

  const splitsTotal = useMemo(() => splits.reduce((s, x) => s + (Number(x.amount) || 0), 0), [splits]);
  const splitsRemaining = Math.round((total - splitsTotal) * 100) / 100;

  const addSplit = () => {
    const amt = Number(String(splitAmount).replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) { toast.error("Valor inválido"); return; }
    if (amt - splitsRemaining > 0.009) { toast.error(`Valor excede o restante (${fmtBRL(splitsRemaining)})`); return; }
    setSplits((s) => [...s, { method: splitMethod, amount: Math.round(amt * 100) / 100 }]);
    setSplitAmount("");
  };
  const fillRemainingSplit = () => {
    if (splitsRemaining <= 0) return;
    setSplitAmount(splitsRemaining.toFixed(2));
  };

  // ---------- Step navigation ----------
  const goNext = () => {
    if (step === 1) {
      if (cart.length === 0) {
        toast.error("Adicione ao menos 1 item");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!customerId && paymentMethod === "fiado") {
        toast.error("Cliente obrigatório para venda na carteira");
        return;
      }
      // Cliente é opcional para outras formas, mas vamos exigir para o cupom ficar mais completo
      if (!customerId) {
        toast.error("Selecione o cliente");
        return;
      }
      setStep(3);
    }
  };
  const goBack = () => setStep((s) => (s === 1 ? 1 : ((s - 1) as Step)));

  // ---------- Save sale ----------
  const finalize = async () => {
    if (cart.length === 0 || !customerId) {
      toast.error("Carrinho ou cliente inválido");
      return;
    }

    // Validação do pagamento misto
    if (splitMode) {
      if (splits.length < 2) { toast.error("Adicione pelo menos 2 formas de pagamento"); return; }
      if (Math.abs(splitsTotal - total) > 0.01) {
        toast.error(`Soma das formas (${fmtBRL(splitsTotal)}) difere do total (${fmtBRL(total)})`);
        return;
      }
    }

    const effectiveMethod: PaymentMethod | "misto" = splitMode ? "misto" : paymentMethod;
    const isCredit = !splitMode && paymentMethod === "credito";
    const isFiado = !splitMode && paymentMethod === "fiado";
    const numInstallments =
      isCredit || isFiado ? Math.max(1, installments) : 1;
    const willCreateReceivables = isFiado || (isCredit && generateReceivables);

    // Portion na carteira (fiado) no modo misto — gera 1 conta a receber no vencimento escolhido
    const splitFiadoAmount = splitMode
      ? splits.filter((s) => s.method === "fiado").reduce((a, b) => a + b.amount, 0)
      : 0;

    setSaving(true);
    try {
      let firstReceivableId: string | null = null;

      // 1) Contas a receber (uma por parcela)
      if (willCreateReceivables) {
        // Base = data da 1ª parcela escolhida (default 30 dias para fiado/crédito)
        const baseDate = new Date(firstDueDate + "T00:00:00");
        const totalParts = numInstallments;
        const parcelaValor = Math.round((total / totalParts) * 100) / 100;
        const records: any[] = [];
        for (let i = 0; i < totalParts; i++) {
          // 1ª parcela na data escolhida; demais somam meses a partir dela
          const due = i === 0 ? baseDate : addMonths(baseDate, i);
          // Ajusta centavos da última parcela
          const valor =
            i === totalParts - 1
              ? Math.round((total - parcelaValor * (totalParts - 1)) * 100) / 100
              : parcelaValor;
          records.push({
            customer_id: customerId,
            amount: valor,
            due_date: due.toISOString().slice(0, 10),
            description:
              totalParts === 1
                ? `${PAYMENT_LABELS[paymentMethod]} — ${cart.length} item(ns)`
                : `${PAYMENT_LABELS[paymentMethod]} (${i + 1}/${totalParts}) — ${cart.length} item(ns)`,
            status: "pendente",
          });
        }
        const { data: recs, error: recErr } = await supabase
          .from("accounts_receivable")
          .insert(records)
          .select();
        if (recErr) throw recErr;
        firstReceivableId = recs?.[0]?.id ?? null;
      } else if (splitFiadoAmount > 0) {
        const baseDate = new Date(firstDueDate + "T00:00:00");
        const { data: recs, error: recErr } = await supabase
          .from("accounts_receivable")
          .insert([{
            customer_id: customerId,
            amount: Math.round(splitFiadoAmount * 100) / 100,
            due_date: baseDate.toISOString().slice(0, 10),
            description: `Pagamento misto — parte na carteira — ${cart.length} item(ns)`,
            status: "pendente",
          }])
          .select();
        if (recErr) throw recErr;
        firstReceivableId = recs?.[0]?.id ?? null;
      }

      const splitNote = splitMode
        ? "Misto: " + splits.map((s) => `${PAYMENT_LABELS[s.method]} ${fmtBRL(s.amount)}`).join(" + ")
        : "";
      const finalNotes = [notes, splitNote].filter(Boolean).join(" | ") || null;

      // 2) Cria venda
      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .insert({
          customer_id: customerId,
          receivable_id: firstReceivableId,
          total,
          notes: finalNotes,
          sale_date: new Date().toISOString(),
          payment_method: effectiveMethod,
          installments: numInstallments,
        })
        .select()
        .single();
      if (saleErr) throw saleErr;

      // 3) Itens — revalida variant_id contra o banco (pode ter mudado após consolidações)
      const variantIds = Array.from(new Set(cart.map((it) => it.variantId).filter(Boolean))) as string[];
      const validIds = new Set<string>();
      if (variantIds.length) {
        const { data: existing } = await supabase
          .from("product_variants")
          .select("id")
          .in("id", variantIds);
        (existing ?? []).forEach((v: any) => validIds.add(v.id));
      }
      const resolvedCart = await Promise.all(
        cart.map(async (it) => {
          if (it.isAvulso) return it;
          if (!it.variantId || validIds.has(it.variantId)) return it;
          // Tenta achar variação equivalente (mesmo produto + size/color) que ainda existe
          const [size, color] = (it.variantLabel || "").split(" / ");
          const { data: alt } = await supabase
            .from("product_variants")
            .select("id, quantity")
            .eq("product_id", it.productId)
            .eq("size", size || null)
            .eq("color", color || null)
            .limit(1)
            .maybeSingle();
          return { ...it, variantId: alt?.id ?? null };
        }),
      );

      const items = resolvedCart.map((it) => ({
        sale_id: sale.id,
        product_id: it.isAvulso ? null : it.productId,
        variant_id: it.variantId,
        product_name: it.productName,
        variant_label: it.variantLabel || null,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        unit_cost: it.unitCost,
      }));
      const { error: itErr } = await supabase.from("sale_items").insert(items);
      if (itErr) throw itErr;

      // 4) Baixa estoque (atômico via RPC, a partir do valor atual do banco)
      for (const it of resolvedCart) {
        if (it.variantId) {
          await supabase.rpc("decrement_variant_stock", { variant_id: it.variantId, qty: it.quantity });
        }
      }

      // 5) Cupom
      const cust = customers.find((c) => c.id === customerId) ?? null;
      const cashNum = Number((cashReceived || "0").toString().replace(",", ".")) || 0;
      const change = paymentMethod === "dinheiro" ? Math.max(0, cashNum - total) : 0;
      setReceipt({
        number: sale.id.slice(0, 8).toUpperCase(),
        date: new Date(),
        customer: cust,
        items: [...cart],
        subtotal: total,
        payment: effectiveMethod,
        installments: numInstallments,
        cashReceived: cashNum,
        change,
        splits: splitMode ? [...splits] : undefined,
      });
      setReceiptOpen(true);
      toast.success("Venda registrada");
      // Recarrega produtos pra atualizar estoque
      load();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || "desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  const printReceipt = () => {
    if (!printRef.current) return;
    const html = printRef.current.innerHTML;
    const w = window.open("", "_blank", "width=380,height=600");
    if (!w) {
      toast.error("Bloqueador de pop-up impediu a impressão");
      return;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cupom ${receipt?.number}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0; color: #000; }
        h1,h2,h3,p { margin: 0; }
        .center { text-align: center; }
        .right { text-align: right; }
        .row { display: flex; justify-content: space-between; gap: 6px; }
        .sep { border-top: 1px dashed #000; margin: 6px 0; }
        .bold { font-weight: bold; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 2px 0; vertical-align: top; }
      </style></head><body>${html}
      <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); }<\/script>
      </body></html>`);
    w.document.close();
  };

  const closeReceiptAndReset = () => {
    setReceiptOpen(false);
    setReceipt(null);
    resetAll();
  };

  const totalAfterCash = paymentMethod === "dinheiro"
    ? Math.max(0, (Number((cashReceived || "0").replace(",", ".")) || 0) - total)
    : 0;

  return (
    <div>
      <PageHeader
        title="Frente de Caixa (PDV)"
        description="Venda rápida com produtos, cliente, pagamento e cupom"
      />

      {/* Stepper indicator */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        {[
          { n: 1, label: "Produtos" },
          { n: 2, label: "Cliente" },
          { n: 3, label: "Pagamento" },
        ].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${
                step >= (s.n as Step)
                  ? "bg-gradient-primary text-primary-foreground shadow-glow"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {s.n}
            </div>
            <span className={step === s.n ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
            {i < 2 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* MAIN COLUMN */}
        <div className="lg:col-span-2 space-y-4">
          {step === 1 && (
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Buscar por nome ou SKU…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="glass-input"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl whitespace-nowrap"
                  onClick={() => {
                    setAvulsoName(search);
                    setAvulsoPrice("");
                    setAvulsoQty(1);
                    setAvulsoOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" /> Produto avulso
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto pr-1">
                {filteredProducts.map((p) => {
                  const stock = p.product_variants.reduce((s, v) => s + v.quantity, 0);
                  return (
                    <button
                      key={p.id}
                      onClick={() => addProductToCart(p)}
                      disabled={stock === 0 && p.product_variants.length > 0}
                      className="group text-left rounded-xl border border-white/30 bg-white/40 dark:bg-white/5 backdrop-blur p-2 hover:shadow-glow hover:border-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="aspect-square rounded-lg overflow-hidden bg-muted mb-2 flex items-center justify-center">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <ShoppingCart className="h-8 w-8 text-muted-foreground" />
                        )}
                      </div>
                      <div className="text-xs font-medium line-clamp-2">{p.name}</div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-xs font-bold text-primary">{fmtBRL(p.price)}</span>
                        <span className="text-[10px] text-muted-foreground">est: {stock}</span>
                      </div>
                    </button>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <div className="col-span-full text-center text-sm text-muted-foreground py-6">
                    Nenhum produto encontrado
                  </div>
                )}
              </div>
            </GlassCard>
          )}

          {step === 2 && (
            <GlassCard className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Label className="block">Selecionar cliente</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => {
                    setNewCustomerName(customerSearch);
                    setNewCustomerPhone("");
                    setNewCustomerOpen(true);
                  }}
                >
                  <UserPlus className="h-4 w-4 mr-1" /> Novo cliente
                </Button>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Buscar cliente por nome ou telefone…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="glass-input"
                />
              </div>
              <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCustomerId(c.id)}
                    className={`w-full text-left rounded-lg px-3 py-2 transition-all border ${
                      customerId === c.id
                        ? "bg-gradient-primary text-primary-foreground border-transparent shadow-glow"
                        : "border-white/30 bg-white/40 dark:bg-white/5 hover:border-primary"
                    }`}
                  >
                    <div className="font-medium text-sm">{c.name}{c.nickname ? <span className={`ml-1 text-xs font-normal ${customerId === c.id ? "opacity-90" : "text-muted-foreground"}`}>({c.nickname})</span> : null}</div>
                    {c.phone && (
                      <div className={`text-xs ${customerId === c.id ? "opacity-90" : "text-muted-foreground"}`}>
                        {c.phone}
                      </div>
                    )}
                  </button>
                ))}
                {filteredCustomers.length === 0 && (
                  <div className="text-center py-6 space-y-3">
                    <div className="text-sm text-muted-foreground">Nenhum cliente encontrado</div>
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => {
                        setNewCustomerName(customerSearch);
                        setNewCustomerPhone("");
                        setNewCustomerOpen(true);
                      }}
                    >
                      <UserPlus className="h-4 w-4 mr-1" /> Adicionar novo cliente
                    </Button>
                  </div>
                )}
              </div>
            </GlassCard>
          )}

          {step === 3 && (
            <GlassCard className="p-4">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <Label>Forma de pagamento</Label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={splitMode}
                    onChange={(e) => { setSplitMode(e.target.checked); setSplits([]); setSplitAmount(""); }}
                    className="h-4 w-4"
                  />
                  Pagamento misto (várias formas)
                </label>
              </div>

              {splitMode && (
                <div className="space-y-3 mb-4">
                  <div className="grid grid-cols-[1fr_130px_auto] gap-2">
                    <Select value={splitMethod} onValueChange={(v) => setSplitMethod(v as PaymentMethod)}>
                      <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dinheiro">Dinheiro</SelectItem>
                        <SelectItem value="pix">PIX</SelectItem>
                        <SelectItem value="debito">Cartão de Débito</SelectItem>
                        <SelectItem value="credito">Cartão de Crédito</SelectItem>
                        <SelectItem value="fiado">Carteira (Fiado)</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="Valor"
                        value={splitAmount}
                        onChange={(e) => setSplitAmount(e.target.value)}
                        className="glass-input pr-10"
                      />
                      <button
                        type="button"
                        onClick={fillRemainingSplit}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
                        aria-label="Preencher restante"
                      >
                        MAX
                      </button>
                    </div>
                    <Button type="button" onClick={addSplit} disabled={splitsRemaining <= 0.009}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-1">
                    {splits.map((s, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-white/40 dark:bg-white/5 px-3 py-1.5">
                        <span className="text-sm">{PAYMENT_LABELS[s.method]}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{fmtBRL(s.amount)}</span>
                          <button
                            onClick={() => setSplits((arr) => arr.filter((_, idx) => idx !== i))}
                            className="text-destructive hover:opacity-70"
                            aria-label="Remover"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {splits.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        Adicione as formas de pagamento até somar {fmtBRL(total)}.
                      </p>
                    )}
                  </div>

                  <div className="flex justify-between text-sm border-t border-white/30 pt-2">
                    <span className="text-muted-foreground">Recebido / Restante:</span>
                    <span>
                      <span className="font-semibold">{fmtBRL(splitsTotal)}</span>
                      {" / "}
                      <span className={splitsRemaining > 0.009 ? "font-semibold text-destructive" : "font-semibold text-emerald-600 dark:text-emerald-400"}>
                        {fmtBRL(Math.max(0, splitsRemaining))}
                      </span>
                    </span>
                  </div>

                  {splits.some((s) => s.method === "fiado") && (
                    <div>
                      <Label>Vencimento da parte na carteira</Label>
                      <Input
                        type="date"
                        value={firstDueDate}
                        onChange={(e) => setFirstDueDate(e.target.value)}
                        className="glass-input mt-1"
                      />
                    </div>
                  )}
                </div>
              )}

              {!splitMode && (
              <Tabs
                value={paymentMethod}
                onValueChange={(v) => {
                  setPaymentMethod(v as PaymentMethod);
                  setInstallments(1);
                }}
              >
                <TabsList className="grid grid-cols-5 w-full">
                  <TabsTrigger value="dinheiro">Dinheiro</TabsTrigger>
                  <TabsTrigger value="debito">Débito</TabsTrigger>
                  <TabsTrigger value="credito">Crédito</TabsTrigger>
                  <TabsTrigger value="pix">PIX</TabsTrigger>
                  <TabsTrigger value="fiado">Carteira</TabsTrigger>
                </TabsList>

                <TabsContent value="dinheiro" className="mt-4 space-y-3">
                  <div>
                    <Label>Valor recebido</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={total.toFixed(2)}
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      className="glass-input mt-1 text-lg"
                    />
                  </div>
                  {Number(cashReceived) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Troco:</span>
                      <span className="font-bold text-primary">{fmtBRL(totalAfterCash)}</span>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="debito" className="mt-4">
                  <p className="text-sm text-muted-foreground">Pagamento à vista no débito.</p>
                </TabsContent>

                <TabsContent value="credito" className="mt-4 space-y-3">
                  <div>
                    <Label>Parcelas</Label>
                    <Select
                      value={String(installments)}
                      onValueChange={(v) => setInstallments(Number(v))}
                    >
                      <SelectTrigger className="glass-input mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n === 1 ? "À vista (1x)" : `${n}x de ${fmtBRL(total / n)}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {installments > 1 && (
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={generateReceivables}
                        onChange={(e) => setGenerateReceivables(e.target.checked)}
                        className="h-4 w-4"
                      />
                      Gerar {installments} contas a receber (controle das parcelas)
                    </label>
                  )}
                </TabsContent>

                <TabsContent value="pix" className="mt-4">
                  <p className="text-sm text-muted-foreground">Pagamento à vista via PIX.</p>
                </TabsContent>

                <TabsContent value="fiado" className="mt-4 space-y-3">
                  <div>
                    <Label>Parcelas</Label>
                    <Select
                      value={String(installments)}
                      onValueChange={(v) => setInstallments(Number(v))}
                    >
                      <SelectTrigger className="glass-input mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n === 1
                              ? `À vista — ${fmtBRL(total)}`
                              : `${n}x de ${fmtBRL(total / n)} (mensal)`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Vencimento da 1ª parcela</Label>
                    <Input
                      type="date"
                      value={firstDueDate}
                      onChange={(e) => setFirstDueDate(e.target.value)}
                      className="glass-input mt-1"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Padrão: 30 dias após a compra. Você pode alterar conforme combinado com o cliente.
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {installments === 1
                      ? `Será criada 1 conta a receber vencendo em ${new Date(firstDueDate + "T00:00:00").toLocaleDateString("pt-BR")} na carteira do cliente.`
                      : `Serão criadas ${installments} contas a receber mensais na carteira do cliente (1ª em ${new Date(firstDueDate + "T00:00:00").toLocaleDateString("pt-BR")}).`}
                  </p>
                </TabsContent>
              </Tabs>
              )}

              <div className="mt-4">
                <Label>Observações (opcional)</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="glass-input mt-1"
                  placeholder="Ex: combinou pagar segunda-feira"
                />
              </div>
            </GlassCard>
          )}

          {/* Nav buttons */}
          <div className="flex justify-between gap-2">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={step === 1}
              className="rounded-xl"
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
            {step < 3 ? (
              <Button onClick={goNext} className="rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
                Avançar <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={finalize}
                disabled={saving}
                className="rounded-xl bg-gradient-primary text-primary-foreground shadow-glow"
              >
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Receipt className="h-4 w-4 mr-1" />}
                Finalizar venda
              </Button>
            )}
          </div>
        </div>

        {/* CART SIDEBAR */}
        <div className="lg:sticky lg:top-4 self-start">
          <GlassCard className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" /> Carrinho
              </h3>
              {cart.length > 0 && (
                <Button variant="ghost" size="sm" onClick={resetAll} className="h-7 text-xs">
                  Limpar
                </Button>
              )}
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {cart.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum item no carrinho
                </p>
              )}
              {cart.map((it, i) => (
                <div key={i} className="rounded-lg border border-white/30 bg-white/40 dark:bg-white/5 p-2">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{it.productName}</div>
                      {it.variantLabel && (
                        <div className="text-xs text-muted-foreground">{it.variantLabel}</div>
                      )}
                    </div>
                    <button
                      onClick={() => removeItem(i)}
                      className="text-destructive hover:opacity-70"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-6 w-6"
                        onClick={() => updateQty(i, -1)}
                        disabled={it.quantity <= 1}
                        aria-label="Diminuir quantidade"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        max={it.maxQty}
                        value={it.quantity}
                        onChange={(e) => setQtyExact(i, e.target.value)}
                        onBlur={(e) => {
                          if (!e.target.value || Number(e.target.value) < 1) setQtyExact(i, "1");
                        }}
                        className="h-6 w-12 px-1 text-center text-sm glass-input"
                        aria-label="Quantidade"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-6 w-6"
                        onClick={() => updateQty(i, 1)}
                        disabled={it.quantity >= it.maxQty}
                        aria-label="Aumentar quantidade"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">R$</span>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={it.unitPrice}
                        onChange={(e) => setUnitPrice(i, e.target.value)}
                        onBlur={(e) => {
                          if (!e.target.value || Number(e.target.value) < 0) setUnitPrice(i, "0");
                        }}
                        className="h-6 w-20 px-1 text-right text-sm glass-input"
                        aria-label="Preço unitário"
                      />
                      <span className="text-sm font-semibold ml-1">= {fmtBRL(it.unitPrice * it.quantity)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-white/30 mt-3 pt-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Itens:</span>
                <span>{cart.reduce((s, i) => s + i.quantity, 0)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg">
                <span>Total:</span>
                <span className="text-primary">{fmtBRL(total)}</span>
              </div>
              {customerId && (
                <div className="text-xs text-muted-foreground pt-1 space-y-1">
                  <div>
                    Cliente: <span className="font-medium text-foreground">{customers.find((c) => c.id === customerId)?.name}</span>
                  </div>
                  <div className="flex items-center justify-between" aria-live="polite">
                    <span>Dívida Total:</span>
                    {debtLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (customerDebt ?? 0) > 0 ? (
                      <span className="font-semibold text-destructive">{fmtBRL(customerDebt ?? 0)}</span>
                    ) : (
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">Nenhuma dívida</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>

      {/* VARIANT PICKER DIALOG */}
      <Dialog open={!!variantPickFor} onOpenChange={(o) => !o && setVariantPickFor(null)}>
        <DialogContent className="glass-card border-white/40 max-w-md">
          <DialogHeader>
            <DialogTitle>{variantPickFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Variação</Label>
              <Select value={pickVariantId} onValueChange={setPickVariantId}>
                <SelectTrigger className="glass-input mt-1">
                  <SelectValue placeholder="Selecione tamanho/cor" />
                </SelectTrigger>
                <SelectContent>
                  {variantPickFor?.product_variants.map((v) => (
                    <SelectItem key={v.id} value={v.id} disabled={v.quantity === 0}>
                      {[v.size, v.color].filter(Boolean).join(" / ") || "—"} (estoque: {v.quantity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quantidade</Label>
              <Input
                type="number"
                min={1}
                value={pickQty}
                onChange={(e) => setPickQty(Math.max(1, Number(e.target.value) || 1))}
                className="glass-input mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVariantPickFor(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmVariant} className="bg-gradient-primary text-primary-foreground">
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PRODUTO AVULSO DIALOG */}
      <Dialog open={avulsoOpen} onOpenChange={setAvulsoOpen}>
        <DialogContent className="glass-card border-white/40 max-w-md">
          <DialogHeader>
            <DialogTitle>Produto avulso</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Adiciona um item que não está no estoque. Não afeta o cadastro de produtos nem o inventário.
            </p>
            <div>
              <Label>Nome do produto</Label>
              <Input
                autoFocus
                value={avulsoName}
                onChange={(e) => setAvulsoName(e.target.value)}
                placeholder="Ex.: Sacola personalizada"
                className="glass-input mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor unitário (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={avulsoPrice}
                  onChange={(e) => setAvulsoPrice(e.target.value)}
                  placeholder="0,00"
                  className="glass-input mt-1"
                />
              </div>
              <div>
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  min={1}
                  value={avulsoQty}
                  onChange={(e) => setAvulsoQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="glass-input mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvulsoOpen(false)}>Cancelar</Button>
            <Button
              className="bg-gradient-primary text-primary-foreground"
              onClick={() => {
                const name = avulsoName.trim();
                const price = Number(String(avulsoPrice).replace(",", "."));
                const qty = Math.max(1, Math.floor(avulsoQty));
                if (!name) { toast.error("Informe o nome"); return; }
                if (!Number.isFinite(price) || price < 0) { toast.error("Valor inválido"); return; }
                pushItem({
                  productId: `avulso-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  variantId: null,
                  productName: name,
                  variantLabel: "",
                  sku: null,
                  quantity: qty,
                  unitPrice: Math.round(price * 100) / 100,
                  unitCost: 0,
                  maxQty: 9999,
                  isAvulso: true,
                });
                setAvulsoOpen(false);
                setAvulsoName("");
                setAvulsoPrice("");
                setAvulsoQty(1);
                toast.success("Item avulso adicionado");
              }}
            >
              Adicionar ao carrinho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RECEIPT DIALOG */}
      <Dialog open={receiptOpen} onOpenChange={(o) => !o && closeReceiptAndReset()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cupom — Pré-visualização</DialogTitle>
          </DialogHeader>
          {receipt && (
            <div ref={printRef} className="font-mono text-xs leading-tight bg-white text-black p-4 rounded">
              <div className="center">
                <div className="bold" style={{ fontSize: 14 }}>JMK MODA</div>
                <div>Cupom Não-Fiscal</div>
                <div>Nº {receipt.number}</div>
                <div>{receipt.date.toLocaleString("pt-BR")}</div>
              </div>
              <div className="sep" />
              {receipt.customer && (
                <>
                  <div>Cliente: {receipt.customer.name}</div>
                  {receipt.customer.phone && <div>Tel: {receipt.customer.phone}</div>}
                  <div className="sep" />
                </>
              )}
              <table>
                <tbody>
                  {receipt.items.map((it, i) => (
                    <tr key={i}>
                      <td>
                        {it.productName}
                        {it.variantLabel ? ` (${it.variantLabel})` : ""}
                        <br />
                        {it.quantity} x {fmtBRL(it.unitPrice)}
                      </td>
                      <td className="right">{fmtBRL(it.unitPrice * it.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sep" />
              <div className="row bold" style={{ fontSize: 13 }}>
                <span>TOTAL</span>
                <span>{fmtBRL(receipt.subtotal)}</span>
              </div>
              <div className="sep" />
              <div>Pagamento: {PAYMENT_LABELS[receipt.payment]}</div>
              {receipt.payment === "credito" && receipt.installments > 1 && (
                <div>
                  {receipt.installments}x de {fmtBRL(receipt.subtotal / receipt.installments)}
                </div>
              )}
              {receipt.payment === "dinheiro" && receipt.cashReceived > 0 && (
                <>
                  <div className="row">
                    <span>Recebido:</span>
                    <span>{fmtBRL(receipt.cashReceived)}</span>
                  </div>
                  <div className="row">
                    <span>Troco:</span>
                    <span>{fmtBRL(receipt.change)}</span>
                  </div>
                </>
              )}
              {receipt.payment === "fiado" && (
                <>
                  {receipt.installments > 1 && (
                    <div>
                      {receipt.installments}x de {fmtBRL(receipt.subtotal / receipt.installments)}
                    </div>
                  )}
                  <div>Lançado na carteira do cliente.</div>
                </>
              )}
              <div className="sep" />
              <div className="center">Obrigado pela preferência!</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeReceiptAndReset}>
              Fechar
            </Button>
            <Button onClick={printReceipt} className="bg-gradient-primary text-primary-foreground">
              <Printer className="h-4 w-4 mr-1" /> Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent className="glass-card border-white/40 max-w-md">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block">Nome *</Label>
              <Input
                autoFocus
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                placeholder="Nome do cliente"
                className="glass-input"
              />
            </div>
            <div>
              <Label className="mb-1 block">Telefone</Label>
              <Input
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
                placeholder="(00) 00000-0000"
                className="glass-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCustomerOpen(false)} disabled={creatingCustomer}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                const name = newCustomerName.trim();
                if (!name) { toast.error("Informe o nome"); return; }
                setCreatingCustomer(true);
                const { data, error } = await supabase
                  .from("customers")
                  .insert({ name, phone: newCustomerPhone.trim() || null })
                  .select("id, name, phone")
                  .single();
                setCreatingCustomer(false);
                if (error || !data) { toast.error(error?.message || "Falha ao cadastrar"); return; }
                setCustomers((prev) => [...prev, data as Customer].sort((a, b) => a.name.localeCompare(b.name)));
                setCustomerId(data.id);
                setCustomerSearch("");
                setNewCustomerOpen(false);
                toast.success("Cliente cadastrado");
              }}
              disabled={creatingCustomer}
              className="bg-gradient-primary text-primary-foreground"
            >
              {creatingCustomer ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}
              Cadastrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
