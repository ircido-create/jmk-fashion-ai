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

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [c, s, r] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).maybeSingle(),
      supabase.from("sales").select("*, sale_items(*)").eq("customer_id", id).order("sale_date", { ascending: false }),
      supabase.from("accounts_receivable").select("id, amount, due_date, status, paid_at, description").eq("customer_id", id).order("due_date", { ascending: true }),
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
    () => receivables.filter(r => r.status !== "pago"),
    [receivables]
  );

  const selectedTotal = useMemo(
    () => pendingReceivables.filter(r => selected.has(r.id)).reduce((s, r) => s + Number(r.amount), 0),
    [pendingReceivables, selected]
  );

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === pendingReceivables.length) setSelected(new Set());
    else setSelected(new Set(pendingReceivables.map(r => r.id)));
  };

  const paySelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Marcar ${selected.size} parcela(s) como paga(s)? Total: ${fmtBRL(selectedTotal)}`)) return;
    setPaying(true);
    const { error } = await supabase
      .from("accounts_receivable")
      .update({ status: "pago", paid_at: new Date().toISOString() })
      .in("id", Array.from(selected));
    setPaying(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${selected.size} parcela(s) quitada(s)`);
    await load();
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
            <Stat label="Pendentes no prazo" value={trust.openPending} icon={<ShoppingBag className="h-3.5 w-3.5 text-primary" />} />
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
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="p-3 rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur">
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">{icon} {label}</div>
      <div className="text-xl font-semibold mt-0.5">{value}</div>
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
