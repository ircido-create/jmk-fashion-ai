import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import {
  TrendingUp, TrendingDown, Package, Users, AlertTriangle, DollarSign,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Stats {
  customers: number;
  products: number;
  receivable: number;
  payable: number;
  overdue: number;
  lowStock: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    customers: 0, products: 0, receivable: 0, payable: 0, overdue: 0, lowStock: 0,
  });
  const [chart, setChart] = useState<{ month: string; receber: number; pagar: number }[]>([]);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [c, p, r, ap, od, ls] = await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true }),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true),
      supabase.from("accounts_receivable").select("amount").eq("status", "pendente"),
      supabase.from("accounts_payable").select("amount").eq("status", "pendente"),
      supabase.from("accounts_receivable").select("id", { count: "exact", head: true }).eq("status", "pendente").lt("due_date", today),
      supabase.from("product_variants").select("quantity, products!inner(low_stock_threshold)"),
    ]);

    const lowStock = (ls.data ?? []).filter((v: any) => v.quantity <= (v.products?.low_stock_threshold ?? 5)).length;

    setStats({
      customers: c.count ?? 0,
      products: p.count ?? 0,
      receivable: (r.data ?? []).reduce((s, x) => s + Number(x.amount), 0),
      payable: (ap.data ?? []).reduce((s, x) => s + Number(x.amount), 0),
      overdue: od.count ?? 0,
      lowStock,
    });

    // chart: last 6 months
    const months = Array.from({ length: 6 }).map((_, i) => {
      const d = startOfMonth(subMonths(new Date(), 5 - i));
      return d;
    });
    const start = months[0].toISOString().slice(0, 10);
    const [recAll, payAll] = await Promise.all([
      supabase.from("accounts_receivable").select("amount, due_date").gte("due_date", start),
      supabase.from("accounts_payable").select("amount, due_date").gte("due_date", start),
    ]);
    const data = months.map((m) => {
      const key = format(m, "yyyy-MM");
      const receber = (recAll.data ?? []).filter((x) => x.due_date.startsWith(key)).reduce((s, x) => s + Number(x.amount), 0);
      const pagar = (payAll.data ?? []).filter((x) => x.due_date.startsWith(key)).reduce((s, x) => s + Number(x.amount), 0);
      return { month: format(m, "MMM", { locale: ptBR }), receber, pagar };
    });
    setChart(data);
  };

  const cards = [
    { label: "A Receber", value: `R$ ${stats.receivable.toFixed(2)}`, icon: TrendingUp, gradient: "from-emerald-400 to-teal-500" },
    { label: "A Pagar", value: `R$ ${stats.payable.toFixed(2)}`, icon: TrendingDown, gradient: "from-rose-400 to-pink-500" },
    { label: "Vencidos", value: stats.overdue, icon: AlertTriangle, gradient: "from-amber-400 to-orange-500" },
    { label: "Clientes", value: stats.customers, icon: Users, gradient: "from-violet-400 to-purple-500" },
    { label: "Produtos", value: stats.products, icon: Package, gradient: "from-fuchsia-400 to-pink-500" },
    { label: "Estoque baixo", value: stats.lowStock, icon: DollarSign, gradient: "from-blue-400 to-indigo-500" },
  ];

  return (
    <div>
      <PageHeader title="Painel" description="Visão geral da sua loja" />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-6">
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
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip
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
