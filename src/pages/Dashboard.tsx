import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import {
  TrendingUp, TrendingDown, Package, Users, AlertTriangle, DollarSign,
  ShoppingCart, Calendar, Eye, EyeOff, Wallet,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";

interface Stats {
  customers: number;
  products: number;
  receivable: number;
  payable: number;
  overdue: number;
  overdueAmount: number;
  lowStock: number;
  salesToday: number;
  salesMonth: number;
  receivedMonth: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    customers: 0, products: 0, receivable: 0, payable: 0, overdue: 0, overdueAmount: 0, lowStock: 0,
    salesToday: 0, salesMonth: 0, receivedMonth: 0,
  });
  const [chart, setChart] = useState<{ month: string; receber: number; pagar: number }[]>([]);
  const [showValues, setShowValues] = useState(true);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = startOfMonth(new Date()).toISOString().slice(0, 10);
    const [c, p, r, ap, od, ls, salesRows, receivedRows] = await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true }),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true),
      fetchAll<{ amount: number }>((sb) => sb.from("accounts_receivable").select("amount").in("status", ["pendente", "vencido"])),
      fetchAll<{ amount: number }>((sb) => sb.from("accounts_payable").select("amount").in("status", ["pendente", "vencido"])),
      fetchAll<{ amount: number }>((sb) => sb.from("accounts_receivable").select("amount").in("status", ["pendente", "vencido"]).lt("due_date", today)),
      fetchAll<any>((sb) => sb.from("product_variants").select("quantity, products!inner(low_stock_threshold)")),
      fetchAll<{ total: number; sale_date: string }>((sb) => sb.from("sales").select("total, sale_date")),
      fetchAll<{ amount_paid: number; created_at: string }>((sb) => sb.from("receivable_payments").select("amount_paid, created_at")),
    ]);

    const lowStock = ls.filter((v: any) => v.quantity <= (v.products?.low_stock_threshold ?? 5)).length;

    const salesToday = salesRows
      .filter((s) => s.sale_date.slice(0, 10) === today)
      .reduce((sum, s) => sum + Number(s.total), 0);
    const salesMonth = salesRows
      .filter((s) => s.sale_date.slice(0, 10) >= monthStart)
      .reduce((sum, s) => sum + Number(s.total), 0);
    const receivedMonth = receivedRows
      .filter((p) => p.created_at.slice(0, 10) >= monthStart)
      .reduce((sum, p) => sum + Number(p.amount_paid), 0);

    setStats({
      customers: c.count ?? 0,
      products: p.count ?? 0,
      receivable: r.reduce((s, x) => s + Number(x.amount), 0),
      payable: ap.reduce((s, x) => s + Number(x.amount), 0),
      overdue: od.length,
      overdueAmount: od.reduce((s, x) => s + Number(x.amount), 0),
      lowStock,
      salesToday,
      salesMonth,
      receivedMonth,
    });

    // chart: last 6 months
    const months = Array.from({ length: 6 }).map((_, i) => {
      const d = startOfMonth(subMonths(new Date(), 5 - i));
      return d;
    });
    const start = months[0].toISOString().slice(0, 10);
    const [recAll, payAll] = await Promise.all([
      fetchAll<{ amount: number; due_date: string }>((sb) => sb.from("accounts_receivable").select("amount, due_date").gte("due_date", start)),
      fetchAll<{ amount: number; due_date: string }>((sb) => sb.from("accounts_payable").select("amount, due_date").gte("due_date", start)),
    ]);
    const data = months.map((m) => {
      const key = format(m, "yyyy-MM");
      const receber = recAll.filter((x) => x.due_date.startsWith(key)).reduce((s, x) => s + Number(x.amount), 0);
      const pagar = payAll.filter((x) => x.due_date.startsWith(key)).reduce((s, x) => s + Number(x.amount), 0);
      return { month: format(m, "MMM", { locale: ptBR }), receber, pagar };
    });
    setChart(data);
  };

  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const mask = () => "••••••";
  const maskBrl = () => "R$ ••••••";

  const cards = [
    { label: "Vendas do Dia", value: showValues ? brl(stats.salesToday) : maskBrl(), sub: "Hoje", icon: ShoppingCart, gradient: "from-emerald-400 to-teal-500" },
    { label: "Vendas do Mês", value: showValues ? brl(stats.salesMonth) : maskBrl(), sub: format(new Date(), "MMMM", { locale: ptBR }), icon: Calendar, gradient: "from-violet-400 to-purple-500" },
    { label: "Recebido no Mês", value: showValues ? brl(stats.receivedMonth) : maskBrl(), sub: "Pagamentos", icon: Wallet, gradient: "from-sky-400 to-cyan-500" },
    { label: "A Receber", value: showValues ? brl(stats.receivable) : maskBrl(), icon: TrendingUp, gradient: "from-emerald-400 to-teal-500" },
    { label: "A Pagar", value: showValues ? brl(stats.payable) : maskBrl(), icon: TrendingDown, gradient: "from-rose-400 to-pink-500" },
    { label: "Vencidos", value: showValues ? brl(stats.overdueAmount) : maskBrl(), sub: `${stats.overdue} título(s)`, icon: AlertTriangle, gradient: "from-amber-400 to-orange-500" },
    { label: "Clientes", value: showValues ? stats.customers.toLocaleString("pt-BR") : mask(), icon: Users, gradient: "from-violet-400 to-purple-500" },
    { label: "Produtos", value: showValues ? stats.products.toLocaleString("pt-BR") : mask(), icon: Package, gradient: "from-fuchsia-400 to-pink-500" },
    { label: "Estoque baixo", value: showValues ? stats.lowStock.toLocaleString("pt-BR") : mask(), icon: DollarSign, gradient: "from-blue-400 to-indigo-500" },
  ];

  return (
    <div>
      <PageHeader
        title="Painel"
        description="Visão geral da sua loja"
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowValues((v) => !v)}
            aria-label={showValues ? "Ocultar valores" : "Mostrar valores"}
            className="rounded-full"
          >
            {showValues ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        {cards.map((c, i) => (
          <div
            key={c.label}
            className="glass-card p-4 md:p-5 animate-fade-in glow-on-hover"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${c.gradient} flex items-center justify-center shadow-soft`}>
                <c.icon className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="text-xl md:text-2xl font-display font-bold mt-1">{c.value}</div>
            {(c as any).sub && <div className="text-[11px] text-muted-foreground mt-1">{(c as any).sub}</div>}
          </div>
        ))}
      </div>

      <GlassCard>
        <h3 className="font-display font-semibold text-lg mb-4">Movimentação dos últimos 6 meses</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => brl(Number(v))} />
              <Tooltip
                formatter={(v: any) => showValues ? brl(Number(v)) : "••••••"}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12,
                }}
              />
              <Bar dataKey="receber" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} name="A receber" />
              <Bar dataKey="pagar" fill="hsl(var(--accent))" radius={[8, 8, 0, 0]} name="A pagar" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </GlassCard>
    </div>
  );
}
