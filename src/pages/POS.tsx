import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Minus, Trash2, Search, ShoppingCart, Loader2, ChevronRight, ChevronLeft, Receipt, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useCustomerDebt } from "@/hooks/useCustomerDebt";
import {
  PAYMENT_LABELS, addPeriod,
  type CartItem, type Customer, type PaymentMethod, type Product,
  type ReceiptData, type ReceivableDraft, type Step,
} from "./pos/types";
import { useCart } from "./pos/useCart";
import { usePaymentSplit } from "./pos/usePaymentSplit";
import { ReceiptDialog } from "./pos/ReceiptDialog";
import { VariantPickerDialog } from "./pos/VariantPickerDialog";
import { AvulsoDialog } from "./pos/AvulsoDialog";



export default function POS() {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const cartApi = useCart();
  const {
    cart, subtotal, total, totalUnits,
    discountValue, setDiscountValue, discountType, setDiscountType, discountAmount,
    pushItem, updateQty, setQtyExact, setUnitPrice, removeItem,
  } = cartApi;
  const [step, setStep] = useState<Step>(1);

  // Step 1 — variant picker
  const [variantPickFor, setVariantPickFor] = useState<Product | null>(null);

  // Step 1 — produto avulso (não cadastrado)
  const [avulsoOpen, setAvulsoOpen] = useState(false);

  // Step 2
  const [customerId, setCustomerId] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 300);
  // Guardado à parte: a lista `customers` muda a cada busca no servidor, e o
  // escolhido não pode sumir do cupom só porque saiu do resultado atual.
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
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

  const [paymentFrequency, setPaymentFrequency] = useState<"mensal" | "quinzenal">("mensal");
  const [manualInstallments, setManualInstallments] = useState<string[]>([]);
  const [isAdjustingInstallments, setIsAdjustingInstallments] = useState(false);

  const splitApi = usePaymentSplit(total);
  const {
    splitMode, setSplitMode, splits, setSplits, splitMethod, setSplitMethod,
    splitAmount, setSplitAmount, splitFiadoInstallments, setSplitFiadoInstallments,
    splitsTotal, splitsRemaining, fiadoAmount,
    addSplit, fillRemainingSplit, removeSplit,
  } = splitApi;

  // Saving + receipt
  const [saving, setSaving] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  // Só o catálogo é carregado de uma vez. Clientes vêm por busca no servidor —
  // trazer a base inteira só para preencher um campo que mostra 50 resultados
  // custava uma requisição por milhar de cadastros antes da primeira venda.
  const load = async () => {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, sku, price, cost, image_url, product_variants(id, size, color, quantity, sku)")
      .eq("active", true)
      .order("name");
    if (error) throw error;
    setProducts((data ?? []) as Product[]);
  };

  useEffect(() => {
    // Sem o catch, uma falha de rede virava unhandled rejection: o operador via
    // um PDV vazio, sem produtos e sem nenhuma mensagem explicando o motivo.
    load().catch((e: any) => {
      toast.error("Não foi possível carregar o catálogo: " + (e?.message ?? "erro desconhecido"));
    });
  }, []);

  // Busca de clientes no servidor, já com o termo debounced.
  useEffect(() => {
    let cancelled = false;
    const termo = debouncedCustomerSearch.trim();

    (async () => {
      let q = supabase.from("customers").select("id, name, nickname, phone").order("name").limit(50);
      if (termo) {
        const escapado = termo.replace(/[%_,]/g, " ");
        q = q.or(`name.ilike.%${escapado}%,nickname.ilike.%${escapado}%,phone.ilike.%${escapado}%`);
      }
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        toast.error("Falha ao buscar clientes: " + error.message);
        return;
      }
      setCustomers((data ?? []) as Customer[]);
    })();

    return () => { cancelled = true; };
  }, [debouncedCustomerSearch]);

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

  // A filtragem agora acontece no servidor; `customers` já vem pronto.
  const filteredCustomers = customers;

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
  };

  /** Limpa a venda inteira para começar a próxima. */
  const resetAll = () => {
    cartApi.reset();   // itens + desconto
    splitApi.reset();  // formas de pagamento misto
    setStep(1);
    setCustomerId(""); setSelectedCustomer(null);
    setCustomerSearch("");
    setPaymentMethod("dinheiro");
    setInstallments(1);
    setGenerateReceivables(true);
    setCashReceived("");
    setNotes("");
    setPaymentFrequency("mensal");
    setManualInstallments([]);
    setIsAdjustingInstallments(false);
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setFirstDueDate(d.toISOString().slice(0, 10));
  };

  const generatedInstallments = useMemo(() => {
    const isFiado = !splitMode && paymentMethod === "fiado";
    const isCredit = !splitMode && paymentMethod === "credito";
    const splitFiadoAmount = splitMode ? splits.filter(s => s.method === "fiado").reduce((a, b) => a + b.amount, 0) : 0;
    
    let baseAmount = 0;
    let numParts = 1;

    if (isFiado || (isCredit && generateReceivables)) {
      baseAmount = total;
      numParts = Math.max(1, installments);
    } else if (splitFiadoAmount > 0) {
      baseAmount = splitFiadoAmount;
      numParts = Math.max(1, splitFiadoInstallments);
    } else {
      return [];
    }

    if (manualInstallments.length === numParts && isAdjustingInstallments) {
      return manualInstallments.map((v, i) => ({
        index: i,
        amount: Number(v.replace(",", ".")) || 0,
      }));
    }

    const parcelaValor = Math.round((baseAmount / numParts) * 100) / 100;
    return Array.from({ length: numParts }, (_, i) => ({
      index: i,
      amount: i === numParts - 1 
        ? Math.round((baseAmount - parcelaValor * (numParts - 1)) * 100) / 100 
        : parcelaValor,
    }));
  }, [total, installments, splitMode, splits, splitFiadoInstallments, paymentMethod, generateReceivables, manualInstallments, isAdjustingInstallments]);

  const manualTotal = useMemo(() => generatedInstallments.reduce((s, x) => s + x.amount, 0), [generatedInstallments]);
  const manualDiff = Math.round(((!splitMode && (paymentMethod === "fiado" || (paymentMethod === "credito" && generateReceivables)) ? total : splitMode ? splits.filter(s => s.method === "fiado").reduce((a, b) => a + b.amount, 0) : 0) - manualTotal) * 100) / 100;


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
    const willCreateReceivables = isFiado || (isCredit && generateReceivables);

    // Portion na carteira (fiado) no modo misto — pode ser parcelada
    const splitFiadoAmount = splitMode
      ? splits.filter((s) => s.method === "fiado").reduce((a, b) => a + b.amount, 0)
      : 0;

    const numInstallments =
      isCredit || isFiado
        ? Math.max(1, installments)
        : splitFiadoAmount > 0
          ? Math.max(1, splitFiadoInstallments)
          : 1;


    setSaving(true);
    try {
      // Revalida o cliente no banco — evita FK violation se o cadastro foi removido/mesclado
      const { data: custCheck, error: custErr } = await supabase
        .from("customers")
        .select("id")
        .eq("id", customerId)
        .maybeSingle();
      if (custErr) throw custErr;
      if (!custCheck) {
        toast.error("Cliente não existe mais no cadastro. Selecione outro.");
        setCustomers((prev) => prev.filter((c) => c.id !== customerId));
        setCustomerId(""); setSelectedCustomer(null);
        setSaving(false);
        return;
      }

      // 1) Monta as parcelas — a gravação acontece junto com a venda, na RPC.
      const records: ReceivableDraft[] = [];
      if (willCreateReceivables || splitFiadoAmount > 0) {
        const baseDate = new Date(firstDueDate + "T00:00:00");
        const totalAmount = willCreateReceivables ? total : splitFiadoAmount;
        
        if (isAdjustingInstallments && Math.abs(manualDiff) > 0.01) {
          toast.error(`A soma das parcelas ajustadas (${fmtBRL(manualTotal)}) não confere com o total da carteira (${fmtBRL(totalAmount)})`);
          setSaving(false);
          return;
        }

        for (let i = 0; i < generatedInstallments.length; i++) {
          const inst = generatedInstallments[i];
          const due = i === 0 ? baseDate : addPeriod(baseDate, i, paymentFrequency);
          
          records.push({
            customer_id: customerId,
            amount: inst.amount,
            due_date: due.toISOString().slice(0, 10),
            description:
              generatedInstallments.length === 1
                ? `${PAYMENT_LABELS[splitMode ? "fiado" : paymentMethod]} — ${cart.length} item(ns)`
                : `${PAYMENT_LABELS[splitMode ? "fiado" : paymentMethod]} (${i + 1}/${generatedInstallments.length}) — ${cart.length} item(ns)`,
            status: "pendente",
          });
        }
      }


      const splitNote = splitMode
        ? "Misto: " + splits.map((s) => `${PAYMENT_LABELS[s.method]} ${fmtBRL(s.amount)}`).join(" + ")
        : "";
      const discountNote =
        discountAmount > 0
          ? `Desconto: ${fmtBRL(discountAmount)}${discountType === "percent" ? ` (${discountValue}%)` : ""} sobre ${fmtBRL(subtotal)}`
          : "";
      const finalNotes = [notes, discountNote, splitNote].filter(Boolean).join(" | ") || null;

      // 2) Itens — revalida variant_id contra o banco (pode ter mudado após consolidações)
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

      // 3) Grava tudo numa transação só: parcelas, venda, vínculo, itens e baixa
      // de estoque. Ou grava inteiro, ou não grava nada — sem estado intermediário.
      const { data: saleId, error: saleErr } = await supabase.rpc("create_sale", {
        p_customer_id: customerId,
        p_total: total,
        p_payment_method: effectiveMethod,
        p_installments: numInstallments,
        p_notes: finalNotes,
        p_items: resolvedCart.map((it) => ({
          product_id: it.isAvulso ? null : it.productId,
          variant_id: it.variantId,
          product_name: it.productName,
          variant_label: it.variantLabel || null,
          quantity: it.quantity,
          unit_price: it.unitPrice,
          unit_cost: it.unitCost,
        })),
        p_receivables: records,
      });
      if (saleErr) throw saleErr;
      const sale = { id: saleId as string };

      // 4) Cupom
      const cust = selectedCustomer;
      const cashNum = Number((cashReceived || "0").toString().replace(",", ".")) || 0;
      const change = paymentMethod === "dinheiro" ? Math.max(0, cashNum - total) : 0;
      setReceipt({
        number: sale.id.slice(0, 8).toUpperCase(),
        date: new Date(),
        customer: cust,
        items: [...cart],
        subtotal: total,
        grossSubtotal: subtotal,
        discount: discountAmount,
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
                      className="group text-left rounded-xl border border-border bg-white/40 dark:bg-white/5 backdrop-blur p-2 hover:shadow-glow hover:border-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
                    onClick={() => { setCustomerId(c.id); setSelectedCustomer(c); }}
                    className={`w-full text-left rounded-lg px-3 py-2 transition-all border ${
                      customerId === c.id
                        ? "bg-gradient-primary text-primary-foreground border-transparent shadow-glow"
                        : "border-border bg-white/40 dark:bg-white/5 hover:border-primary"
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
                    onChange={(e) => { setSplitMode(e.target.checked); setSplits([]); setSplitAmount(""); setSplitFiadoInstallments(1); }}
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
                            onClick={() => removeSplit(i)}
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

                  <div className="flex justify-between text-sm border-t border-border pt-2">
                    <span className="text-muted-foreground">Recebido / Restante:</span>
                    <span>
                      <span className="font-semibold">{fmtBRL(splitsTotal)}</span>
                      {" / "}
                      <span className={splitsRemaining > 0.009 ? "font-semibold text-destructive" : "font-semibold text-emerald-600 dark:text-emerald-400"}>
                        {fmtBRL(Math.max(0, splitsRemaining))}
                      </span>
                    </span>
                  </div>

                  {splits.some((s) => s.method === "fiado") && (() => {
                    const parts = Math.max(1, splitFiadoInstallments);
                    return (
                      <div className="space-y-3 rounded-xl bg-white/40 dark:bg-white/5 p-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex-1">
                            <Label>Parcelas da parte na carteira</Label>
                            <Select
                              value={String(splitFiadoInstallments)}
                              onValueChange={(v) => { setSplitFiadoInstallments(Number(v)); setManualInstallments([]); setIsAdjustingInstallments(false); }}
                            >
                              <SelectTrigger className="glass-input mt-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                                  <SelectItem key={n} value={String(n)}>
                                    {n}x de {fmtBRL(fiadoAmount / n)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Periodicidade</Label>
                            <Select
                              value={paymentFrequency}
                              onValueChange={(v) => setPaymentFrequency(v as "mensal" | "quinzenal")}
                            >
                              <SelectTrigger className="glass-input mt-1 w-[120px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="mensal">Mensal</SelectItem>
                                <SelectItem value="quinzenal">Quinzenal</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Adjust values button */}
                        <div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs rounded-lg h-7"
                            onClick={() => {
                              if (!isAdjustingInstallments) {
                                setManualInstallments(generatedInstallments.map(g => g.amount.toString()));
                              }
                              setIsAdjustingInstallments(!isAdjustingInstallments);
                            }}
                          >
                            {isAdjustingInstallments ? "Cancelar ajuste manual" : "Ajustar valores (Arredondar)"}
                          </Button>
                        </div>

                        {isAdjustingInstallments && (
                          <div className="space-y-2 pt-2 border-t border-border">
                            {manualInstallments.map((val, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground w-16">{idx + 1}ª Parcela:</span>
                                <div className="flex-1 relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    className="h-7 pl-7 text-xs glass-input"
                                    value={val}
                                    onChange={(e) => {
                                      const next = [...manualInstallments];
                                      next[idx] = e.target.value;
                                      setManualInstallments(next);
                                    }}
                                  />
                                </div>
                              </div>
                            ))}
                            <div className="flex justify-between items-center text-xs font-medium pt-1">
                              <span>Total Carteira: {fmtBRL(fiadoAmount)}</span>
                              <span className={Math.abs(manualDiff) > 0.01 ? "text-destructive" : "text-emerald-500"}>
                                Dif: {fmtBRL(manualDiff)}
                              </span>
                            </div>
                          </div>
                        )}
                        <div>
                          <Label>Vencimento da 1ª parcela</Label>
                          <Input
                            type="date"
                            value={firstDueDate}
                            onChange={(e) => setFirstDueDate(e.target.value)}
                            className="glass-input mt-1"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {parts === 1
                            ? `1 conta a receber de ${fmtBRL(fiadoAmount)} em ${new Date(firstDueDate + "T00:00:00").toLocaleDateString("pt-BR")}.`
                            : `${parts}x de ${fmtBRL(fiadoAmount / parts)} — 1ª em ${new Date(firstDueDate + "T00:00:00").toLocaleDateString("pt-BR")}, demais mensais.`}
                        </p>
                      </div>
                    );
                  })()}

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
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <Label>Parcelas</Label>
                        <Select
                          value={String(installments)}
                          onValueChange={(v) => { setInstallments(Number(v)); setManualInstallments([]); setIsAdjustingInstallments(false); }}
                        >
                          <SelectTrigger className="glass-input mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
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
                        <Label>Periodicidade</Label>
                        <Select
                          value={paymentFrequency}
                          onValueChange={(v) => setPaymentFrequency(v as "mensal" | "quinzenal")}
                        >
                          <SelectTrigger className="glass-input mt-1 w-[120px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mensal">Mensal</SelectItem>
                            <SelectItem value="quinzenal">Quinzenal</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Adjust values button */}
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs rounded-lg h-7"
                        onClick={() => {
                          if (!isAdjustingInstallments) {
                            setManualInstallments(generatedInstallments.map(g => g.amount.toString()));
                          }
                          setIsAdjustingInstallments(!isAdjustingInstallments);
                        }}
                      >
                        {isAdjustingInstallments ? "Cancelar ajuste manual" : "Ajustar valores (Arredondar)"}
                      </Button>
                    </div>

                    {isAdjustingInstallments && (
                      <div className="space-y-2 pt-2 border-t border-border">
                        {manualInstallments.map((val, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground w-16">{idx + 1}ª Parcela:</span>
                            <div className="flex-1 relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                              <Input
                                type="number"
                                step="0.01"
                                className="h-7 pl-7 text-xs glass-input"
                                value={val}
                                onChange={(e) => {
                                  const next = [...manualInstallments];
                                  next[idx] = e.target.value;
                                  setManualInstallments(next);
                                }}
                              />
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-between items-center text-xs font-medium pt-1">
                          <span>Total Venda: {fmtBRL(total)}</span>
                          <span className={Math.abs(manualDiff) > 0.01 ? "text-destructive" : "text-emerald-500"}>
                            Dif: {fmtBRL(manualDiff)}
                          </span>
                        </div>
                      </div>
                    )}
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
                      : `Serão criadas ${installments} contas a receber ${paymentFrequency === "quinzenal" ? "quinzenais" : "mensais"} na carteira do cliente (1ª em ${new Date(firstDueDate + "T00:00:00").toLocaleDateString("pt-BR")}).`}
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
                <div key={i} className="rounded-lg border border-border bg-white/40 dark:bg-white/5 p-2">
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

            {/* Os totais mudam a cada item somado ao carrinho sem que nada receba
                foco; sem aria-live o leitor de tela não anuncia a alteração. */}
            <div
              className="border-t border-border mt-3 pt-3 space-y-1"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Itens:</span>
                <span>{totalUnits}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span>{fmtBRL(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Desconto:</span>
                <div className="flex items-center gap-1">
                  <div className="flex rounded-md overflow-hidden border border-border">
                    <button
                      type="button"
                      onClick={() => setDiscountType("valor")}
                      className={`px-2 py-0.5 text-xs ${discountType === "valor" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground"}`}
                      aria-pressed={discountType === "valor"}
                    >
                      R$
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscountType("percent")}
                      className={`px-2 py-0.5 text-xs ${discountType === "percent" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground"}`}
                      aria-pressed={discountType === "percent"}
                    >
                      %
                    </button>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder="0"
                    className="h-7 w-24 px-2 text-right text-sm glass-input"
                    aria-label="Desconto"
                  />
                </div>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-destructive">
                  <span>Desconto aplicado:</span>
                  <span>- {fmtBRL(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg">
                <span>Total:</span>
                <span className="text-primary">{fmtBRL(total)}</span>
              </div>
              {customerId && (
                <div className="text-xs text-muted-foreground pt-1 space-y-1">
                  <div>
                    Cliente: <span className="font-medium text-foreground">{selectedCustomer?.name}</span>
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
      <VariantPickerDialog
        product={variantPickFor}
        onClose={() => setVariantPickFor(null)}
        onConfirm={pushItem}
      />

      <AvulsoDialog
        open={avulsoOpen}
        initialName={search}
        onOpenChange={setAvulsoOpen}
        onConfirm={pushItem}
      />

      <ReceiptDialog open={receiptOpen} receipt={receipt} onClose={closeReceiptAndReset} />

      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent className="glass-card border-border max-w-md">
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
                  .select("id, name, nickname, phone")
                  .single();
                setCreatingCustomer(false);
                if (error || !data) { toast.error(error?.message || "Falha ao cadastrar"); return; }
                setCustomerId(data.id);
                setSelectedCustomer(data as Customer);
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
