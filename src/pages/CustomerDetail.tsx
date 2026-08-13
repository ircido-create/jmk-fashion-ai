import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Mail, MapPin, Phone, ShoppingBag, TrendingDown, TrendingUp, IdCard, Wallet, CheckCircle2 } from "lucide-react";
import { calculateTrust, trustBgClass, type ReceivableLike } from "@/lib/trustScore";
import { toast } from "sonner";
import { formatTaxId } from "@/lib/taxId";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reconcileManualPayment, type ReceivableLite } from "@/lib/reconcile";

interface Customer {
  id: string; name: string; phone: string | null; email: string | null;
  address: string | null; notes: string | null; tax_id: string | null; created_at: string;
}
interface SaleItem {
  id: string; product_name: string; variant_label: string | null;
  quantity: number; unit_price: number; unit_cost: number;
}
interface Sale {
  id: string; sale_date: string; total: number; notes: string | null;
  receivable_id: string | null;
  sale_items: SaleItem[];
}
interface Receivable {
  id: string; amount: number; due_date: string;
  status: string; paid_at: string | null; description: string | null;
  receivable_payments?: { amount_paid: number }[];
}

const fmtBRL = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (s: string) => new Date(s).toLocaleDateString("pt-BR");

export default function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState("");

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [c, s, r] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).maybeSingle(),
      supabase.from("sales").select("*, sale_items(*)").eq("customer_id", id).order("sale_date", { ascending: false }),
      supabase.from("accounts_receivable").select("id, amount, due_date, status, paid_at, description, receivable_payments(amount_paid)").eq("customer_id", id).order("due_date", { ascending: true }),
    ]);
    if (c.error) toast.error(c.error.message);
    setCustomer(c.data as Customer | null);
    setSales((s.data ?? []) as Sale[]);
    setReceivables((r.data ?? []) as Receivable[]);
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const trust = useMemo(() => calculateTrust(receivables as ReceivableLike[]), [receivables]);

  const pendingReceivables = useMemo(
    () => receivables.filter(r => r.status !== "pago" && r.status !== "cancelado"),
    [receivables]
  );

  const selectedTotal = useMemo(
    () => pendingReceivables.filter(r => selected.has(r.id)).reduce((s, r) => s + Number(r.amount), 0),
    [pendingReceivables, selected]
  );

  const totalDebt = useMemo(
    () => pendingReceivables.reduce((s, r) => s + Number(r.amount), 0),
    [pendingReceivables]
  );

  const creditItems = useMemo(
    () =>
      receivables
        .filter((r) => r.status !== "cancelado")
        .map((r) => {
          const paid = (r.receivable_payments ?? []).reduce((s, p) => s + Number(p.amount_paid || 0), 0);
          return { r, excess: Math.max(0, paid - Number(r.amount || 0)), paid };
        })
        .filter((x) => x.excess > 0.009),
    [receivables]
  );

  const totalCredit = useMemo(
    () => creditItems.reduce((s, x) => s + x.excess, 0),
    [creditItems]
  );


  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === pendingReceivables.length) setSelected(new Set());
    else setSelected(new Set(pendingReceivables.map(r => r.id)));
  };

  const openPayDialog = () => {
    if (selected.size === 0) return;
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayAmount(selectedTotal.toFixed(2));
    setPayOpen(true);
  };

  const confirmPay = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const received = Number(payAmount.replace(",", "."));
    if (!isFinite(received) || received <= 0) { toast.error("Informe um valor válido"); return; }
    if (!payDate) { toast.error("Informe a data do recebimento"); return; }

    setPaying(true);
    try {
      const paidAtIso = new Date(`${payDate}T12:00:00`).toISOString();
      const lite: ReceivableLite[] = pendingReceivables.map((r) => ({
        id: r.id,
        customer_id: id ?? null,
        customer_name: customer?.name ?? "",
        amount: Number(r.amount),
        due_date: r.due_date,
        status: r.status,
      }));
      const result = reconcileManualPayment(lite, received, ids);
      if (result.actions.length === 0) throw new Error("Nenhuma parcela pendente para baixar");

      const settleIds = result.actions.filter((a) => a.kind === "settle").map((a) => a.receivable_id);
      const reduceActions = result.actions.filter((a) => a.kind === "reduce");

      if (settleIds.length > 0) {
        const { error } = await supabase
          .from("accounts_receivable")
          .update({ status: "pago", paid_at: paidAtIso })
          .in("id", settleIds);
        if (error) throw error;
      }

      for (const a of reduceActions) {
        const { error } = await supabase
          .from("accounts_receivable")
          .update({ amount: a.new_amount })
          .eq("id", a.receivable_id);
        if (error) throw error;
      }

      try {
        const { data: proof, error: proofErr } = await supabase
          .from("payment_proofs")
          .insert({
            storage_path: "",
            description: `Recebimento manual — ${customer?.name ?? "cliente"}`,
            payment_date: paidAtIso,
          })
          .select("id")
          .single();
        if (proofErr) throw proofErr;

        const payments = result.actions.map((a) => ({
          receivable_id: a.receivable_id,
          proof_id: proof.id,
          amount_paid: a.amount_paid,
        }));
        const { error: pErr } = await supabase.from("receivable_payments").insert(payments as any);
        if (pErr) throw pErr;
      } catch (historyErr: any) {
        console.warn("receivable_payments insert:", historyErr?.message);
      }

      setPayOpen(false);
      const leftoverMsg = result.leftovers.length > 0 ? ` • sobra ${fmtBRL(result.leftovers[0].amount)}` : "";
      toast.success(
        `${result.totals.fullySettled} parcela(s) quitada(s) + ${result.totals.partiallyReduced} reduzida(s) — ${fmtBRL(result.totals.paidSum)}${leftoverMsg}`
      );
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPaying(false);
    }
  };

  const totals = useMemo(() => {
    let revenue = 0, cost = 0, units = 0;
    for (const sale of sales) {
      for (const it of sale.sale_items ?? []) {
        revenue += Number(it.unit_price) * it.quantity;
        cost += Number(it.unit_cost) * it.quantity;
        units += it.quantity;
      }
    }
    return { revenue, cost, units, profit: revenue - cost };
  }, [sales]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div>
        <Button variant="ghost" onClick={() => nav("/clientes")}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
        <p className="text-muted-foreground mt-4">Cliente não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={() => nav("/clientes")} className="mb-2"><ArrowLeft className="h-4 w-4 mr-1" /> Clientes</Button>

      <PageHeader title={customer.name} description={`Cliente desde ${fmtDate(customer.created_at)}`} />

      {/* Score de confiança */}
      <GlassCard>
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex flex-col items-center md:items-start">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Confiança</div>
            <div className="text-5xl font-display font-bold gradient-text mt-1">{trust.score}%</div>
            <span className={`mt-2 text-xs px-3 py-1 rounded-full border ${trustBgClass(trust.level)}`}>
              {trust.label}
            </span>
          </div>

          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
            <Stat label="Pagos em dia" value={trust.paidOnTime} icon={<TrendingUp className="h-3.5 w-3.5 text-success" />} />
            <Stat label="Pagos em atraso" value={trust.paidLate} icon={<TrendingDown className="h-3.5 w-3.5 text-warning" />} />
            <Stat label="Em aberto vencidos" value={trust.openOverdue} icon={<TrendingDown className="h-3.5 w-3.5 text-destructive" />} />
            <Stat label="Saldo em aberto" value={fmtBRL(totalDebt)} icon={<Wallet className="h-3.5 w-3.5 text-primary" />} accent />
          </div>
        </div>

        {trust.reasoning.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/30">
            <div className="text-xs font-medium text-muted-foreground mb-2">Como esse score foi calculado</div>
            <ul className="text-sm space-y-1">
              {trust.reasoning.map((r, i) => <li key={i} className="text-foreground/80">• {r}</li>)}
            </ul>
            {trust.totalOverdueAmount > 0 && (
              <div className="mt-2 text-sm text-destructive font-medium">
                Valor em aberto vencido: {fmtBRL(trust.totalOverdueAmount)}
              </div>
            )}
          </div>
        )}
      </GlassCard>

      {totalCredit > 0 && (
        <GlassCard>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold flex items-center gap-2 text-success">
              <Wallet className="h-4 w-4" />
              Crédito disponível
            </h3>
            <span className="text-2xl font-bold text-success">{fmtBRL(totalCredit)}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Valor pago acima do total das parcelas. Fica a favor do cliente em compras futuras.
          </p>
          <div className="mt-3 space-y-1">
            {creditItems.map(({ r, excess, paid }) => (
              <div key={r.id} className="flex justify-between text-xs text-muted-foreground">
                <span className="truncate">
                  {r.description || "Parcela"} — venc. {fmtDate(r.due_date)} ({fmtBRL(Number(r.amount))} • pago {fmtBRL(paid)})
                </span>
                <span className="text-success font-medium ml-2">+{fmtBRL(excess)}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Dados de contato */}
      <GlassCard>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div className="flex items-start gap-2"><IdCard className="h-4 w-4 text-muted-foreground mt-0.5" /><div><div className="text-xs text-muted-foreground">CPF / CNPJ</div>{customer.tax_id ? formatTaxId(customer.tax_id) : "—"}</div></div>
          <div className="flex items-start gap-2"><Phone className="h-4 w-4 text-muted-foreground mt-0.5" /><div><div className="text-xs text-muted-foreground">Telefone</div>{customer.phone || "—"}</div></div>
          <div className="flex items-start gap-2"><Mail className="h-4 w-4 text-muted-foreground mt-0.5" /><div className="min-w-0"><div className="text-xs text-muted-foreground">E-mail</div><div className="truncate">{customer.email || "—"}</div></div></div>
          <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-muted-foreground mt-0.5" /><div><div className="text-xs text-muted-foreground">Endereço</div>{customer.address || "—"}</div></div>
        </div>
      </GlassCard>

      {/* Resumo de movimentação */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SmallCard label="Compras" value={String(sales.length)} />
        <SmallCard label="Peças levadas" value={String(totals.units)} />
        <SmallCard label="Total comprado" value={fmtBRL(totals.revenue)} accent />
        <SmallCard label="Lucro gerado" value={fmtBRL(totals.profit)} success />
      </div>

      {/* Parcelas / Carteira */}
      <GlassCard>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            Carteira — Parcelas pendentes
          </h3>
          <span className="text-xs text-muted-foreground">
            {pendingReceivables.length} parcela(s) em aberto
          </span>
        </div>

        {pendingReceivables.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma parcela pendente. 🎉
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 mb-3 p-2 rounded-xl bg-white/40 dark:bg-white/5">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={selected.size === pendingReceivables.length && pendingReceivables.length > 0}
                  onCheckedChange={toggleAll}
                />
                Selecionar todas
              </label>
              <div className="flex items-center gap-3">
                {selected.size > 0 && (
                  <span className="text-sm">
                    <span className="text-muted-foreground">Selecionado:</span>{" "}
                    <span className="font-semibold text-primary">{fmtBRL(selectedTotal)}</span>
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={openPayDialog}
                  disabled={selected.size === 0 || paying}
                >
                  {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                  Pagar selecionadas ({selected.size})
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {pendingReceivables.map((r) => {
                const overdue = new Date(r.due_date) < new Date(new Date().toDateString());
                return (
                  <label
                    key={r.id}
                    className={`flex items-center gap-3 p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur cursor-pointer hover:bg-white/60 transition ${
                      selected.has(r.id) ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.description || "Parcela"}
                      </div>
                      <div className={`text-xs ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        Vence em {fmtDate(r.due_date)} {overdue && "• vencida"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold">{fmtBRL(Number(r.amount))}</div>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </GlassCard>

      {/* Histórico de produtos */}
      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Histórico de compras</h3>
          <span className="text-xs text-muted-foreground">{sales.length} venda(s)</span>
        </div>
        {sales.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma venda registrada.</p>
        ) : (
          <div className="space-y-3">
            {sales.map((sale) => (
              <div key={sale.id} className="p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">{fmtDate(sale.sale_date)}</div>
                  <div className="text-sm font-semibold text-primary">{fmtBRL(Number(sale.total))}</div>
                </div>
                <div className="space-y-1">
                  {(sale.sale_items ?? []).map((it) => (
                    <div key={it.id} className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {it.quantity}× {it.product_name}
                        {it.variant_label ? ` (${it.variant_label})` : ""}
                      </span>
                      <span>{fmtBRL(Number(it.unit_price) * it.quantity)}</span>
                    </div>
                  ))}
                </div>
                {sale.notes && <div className="mt-2 text-xs italic text-muted-foreground">"{sale.notes}"</div>}
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
            <DialogDescription>
              {selected.size} parcela(s) — total esperado {fmtBRL(selectedTotal)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Data do recebimento</Label>
              <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Valor recebido (R$)</Label>
              <Input
                id="pay-amount"
                type="number"
                step="0.01"
                min="0"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              {(() => {
                const v = Number(payAmount.replace(",", "."));
                const diff = v - selectedTotal;
                if (!isFinite(v) || v <= 0 || Math.abs(diff) < 0.01) return null;
                return (
                  <div className={`text-xs ${diff < 0 ? "text-warning" : "text-primary"}`}>
                    {diff < 0 ? "Recebido a menos" : "Recebido a mais"}: {fmtBRL(Math.abs(diff))}
                  </div>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paying}>Cancelar</Button>
            <Button onClick={confirmPay} disabled={paying}>
              {paying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, icon, accent }: { label: string; value: React.ReactNode; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className="p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur">
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">{icon} {label}</div>
      <div className={`text-xl font-semibold mt-0.5 ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function SmallCard({ label, value, accent, success }: { label: string; value: string; accent?: boolean; success?: boolean }) {
  return (
    <div className="p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${accent ? "text-primary" : success ? "text-success" : ""}`}>{value}</div>
    </div>
  );
}
