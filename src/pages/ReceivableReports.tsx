import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAll } from "@/lib/fetchAll";
import { digitsOnly } from "@/lib/taxId";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import {
  ArrowUpDown, Download, FileSpreadsheet, Printer, Search, TrendingUp,
  Users, AlertTriangle, Wallet, CalendarClock, PieChart as PieIcon,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

// ---------- tipos ----------
type Customer = {
  id: string; name: string; nickname: string | null; tax_id: string | null;
  phone: string | null; address: string | null;
};
type Sale = {
  id: string; customer_id: string | null; sale_date: string; total: number;
  payment_method: string | null; notes: string | null;
};
type Receivable = {
  id: string; customer_id: string | null; amount: number; due_date: string;
  status: string; paid_at: string | null; description: string | null; created_at: string;
};
type Payment = { id: string; receivable_id: string; amount_paid: number; created_at: string };

type Bucket = "pago" | "parcial" | "pendente" | "vencido";

// ---------- helpers ----------
const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const fmt = (d: string | null | undefined) =>
  d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("pt-BR") : "—";
const todayISO = () => new Date().toISOString().slice(0, 10);

function bucketOf(r: Receivable, paid: number): Bucket {
  if (r.status === "pago" || paid + 0.005 >= Number(r.amount)) return "pago";
  if (paid > 0.005) return "parcial";
  if (r.due_date < todayISO()) return "vencido";
  return "pendente";
}
const bucketColor: Record<Bucket, string> = {
  pago: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  parcial: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  pendente: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  vencido: "bg-rose-500/15 text-rose-600 border-rose-500/30",
};

function daysBetween(iso: string, ref = todayISO()) {
  const a = new Date(iso + "T00:00:00").getTime();
  const b = new Date(ref + "T00:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

// ---------- página ----------
type DateField = "due_date" | "created_at" | "paid_at";

export default function ReceivableReports() {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  // filtros
  const [search, setSearch] = useState("");
  const dSearch = useDebouncedValue(search, 200);
  const [dateField, setDateField] = useState<DateField>("due_date");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | Bucket>("todos");
  const [minVal, setMinVal] = useState("");
  const [maxVal, setMaxVal] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<string>("todos");

  // extrato modal
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [cus, sls, recs, pays] = await Promise.all([
          fetchAll<Customer>((sb) =>
            sb.from("customers").select("id,name,nickname,tax_id,phone,address").order("name"),
          ),
          fetchAll<Sale>((sb) =>
            sb.from("sales").select("id,customer_id,sale_date,total,payment_method,notes"),
          ),
          fetchAll<Receivable>((sb) =>
            sb.from("accounts_receivable").select("id,customer_id,amount,due_date,status,paid_at,description,created_at"),
          ),
          fetchAll<Payment>((sb) =>
            sb.from("receivable_payments").select("id,receivable_id,amount_paid,created_at"),
          ),
        ]);
        setCustomers(cus);
        setSales(sls);
        setReceivables(recs);
        setPayments(pays);
      } catch (e: any) {
        toast.error("Erro ao carregar dados", { description: e?.message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // índices auxiliares
  const custMap = useMemo(() => {
    const m = new Map<string, Customer>();
    customers.forEach((c) => m.set(c.id, c));
    return m;
  }, [customers]);

  const paymentByRec = useMemo(() => {
    const m = new Map<string, number>();
    payments.forEach((p) => {
      m.set(p.receivable_id, (m.get(p.receivable_id) || 0) + Number(p.amount_paid || 0));
    });
    return m;
  }, [payments]);

  const paymentMethods = useMemo(() => {
    const set = new Set<string>();
    sales.forEach((s) => s.payment_method && set.add(s.payment_method));
    return Array.from(set).sort();
  }, [sales]);

  // linhas enriquecidas (analítico)
  type Row = {
    r: Receivable;
    c: Customer | null;
    sale: Sale | null;
    paid: number;
    saldo: number;
    bucket: Bucket;
    diasAtraso: number;
  };
  const rowsAll: Row[] = useMemo(() => {
    return receivables.map((r) => {
      const paid = paymentByRec.get(r.id) || 0;
      const bucket = bucketOf(r, paid);
      const c = r.customer_id ? custMap.get(r.customer_id) || null : null;
      const sale = sales.find((s) => s.customer_id === r.customer_id) || null; // best-effort
      return {
        r, c, sale, paid,
        saldo: Math.max(0, Number(r.amount) - paid),
        bucket,
        diasAtraso: bucket === "pago" ? 0 : Math.max(0, daysBetween(r.due_date)),
      };
    });
  }, [receivables, paymentByRec, custMap, sales]);

  // aplica filtros
  const rows: Row[] = useMemo(() => {
    const term = dSearch.trim().toLowerCase();
    const termDigits = digitsOnly(term);
    const min = Number(minVal) || -Infinity;
    const max = Number(maxVal) || Infinity;
    return rowsAll.filter((row) => {
      if (statusFilter !== "todos" && row.bucket !== statusFilter) return false;
      // data
      const dv = row.r[dateField as keyof Receivable] as string | null;
      if (from && (!dv || dv.slice(0, 10) < from)) return false;
      if (to && (!dv || dv.slice(0, 10) > to)) return false;
      // valor
      if (Number(row.r.amount) < min || Number(row.r.amount) > max) return false;
      // pagamento
      if (paymentFilter !== "todos") {
        const pm = row.sale?.payment_method || "";
        if (pm !== paymentFilter) return false;
      }
      // termo
      if (term) {
        const c = row.c;
        const hay = [
          c?.name, c?.nickname, c?.tax_id, c?.phone, row.r.description,
        ].filter(Boolean).join(" ").toLowerCase();
        const digHay = digitsOnly([c?.tax_id, c?.phone].filter(Boolean).join(" "));
        if (!hay.includes(term) && !(termDigits && digHay.includes(termDigits))) return false;
      }
      return true;
    });
  }, [rowsAll, dSearch, statusFilter, from, to, minVal, maxVal, paymentFilter, dateField]);

  // ---------- KPIs ----------
  const kpis = useMemo(() => {
    const today = todayISO();
    const totalOriginal = rows.reduce((s, r) => s + Number(r.r.amount), 0);
    const totalPago = rows.reduce((s, r) => s + r.paid, 0);
    const totalAberto = rows.reduce((s, r) => (r.bucket === "pago" ? s : s + r.saldo), 0);
    const totalVencido = rows.filter((r) => r.bucket === "vencido").reduce((s, r) => s + r.saldo, 0);
    const totalAVencer = rows.filter((r) => r.bucket === "pendente").reduce((s, r) => s + r.saldo, 0);
    const inadimplentes = new Set(
      rows.filter((r) => r.bucket === "vencido" && r.c?.id).map((r) => r.c!.id),
    ).size;
    const clientesTotal = new Set(rows.map((r) => r.c?.id).filter(Boolean)).size;
    const ticketMedio = rows.length ? totalOriginal / rows.length : 0;
    const valorMedioCliente = clientesTotal ? totalOriginal / clientesTotal : 0;
    const pctInad = totalOriginal ? (totalVencido / totalOriginal) * 100 : 0;

    const inWindow = (iso: string | null, days: number) => {
      if (!iso) return false;
      const d = iso.slice(0, 10);
      const ref = new Date();
      ref.setDate(ref.getDate() - days);
      return d >= ref.toISOString().slice(0, 10) && d <= today;
    };
    // recebimentos a partir de payments (não filtrados pelo dateField para KPI temporal fixo)
    const recDay = payments
      .filter((p) => inWindow(p.created_at.slice(0, 10), 0))
      .reduce((s, p) => s + Number(p.amount_paid || 0), 0);
    const recWeek = payments
      .filter((p) => inWindow(p.created_at.slice(0, 10), 7))
      .reduce((s, p) => s + Number(p.amount_paid || 0), 0);
    const recMonth = payments
      .filter((p) => inWindow(p.created_at.slice(0, 10), 30))
      .reduce((s, p) => s + Number(p.amount_paid || 0), 0);

    return {
      totalOriginal, totalPago, totalAberto, totalVencido, totalAVencer,
      inadimplentes, ticketMedio, valorMedioCliente, pctInad,
      qtd: rows.length, recDay, recWeek, recMonth,
    };
  }, [rows, payments]);

  // ---------- Sintético por cliente ----------
  type SynRow = {
    customer: Customer | null;
    qtd: number; total: number; pago: number; aberto: number; vencido: number; saldo: number;
  };
  const synthetic: SynRow[] = useMemo(() => {
    const m = new Map<string, SynRow>();
    rows.forEach((row) => {
      const key = row.c?.id ?? "__sem_cliente__";
      const cur = m.get(key) || {
        customer: row.c, qtd: 0, total: 0, pago: 0, aberto: 0, vencido: 0, saldo: 0,
      };
      cur.qtd += 1;
      cur.total += Number(row.r.amount);
      cur.pago += row.paid;
      if (row.bucket !== "pago") cur.saldo += row.saldo;
      if (row.bucket === "vencido") cur.vencido += row.saldo;
      if (row.bucket === "pendente") cur.aberto += row.saldo;
      m.set(key, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.saldo - a.saldo);
  }, [rows]);

  // ---------- Aging ----------
  const aging = useMemo(() => {
    const buckets: Record<string, { label: string; count: number; sum: number; items: Row[] }> = {
      b1: { label: "Até 30 dias", count: 0, sum: 0, items: [] },
      b2: { label: "31 a 60 dias", count: 0, sum: 0, items: [] },
      b3: { label: "61 a 90 dias", count: 0, sum: 0, items: [] },
      b4: { label: "91 a 180 dias", count: 0, sum: 0, items: [] },
      b5: { label: "Acima de 180 dias", count: 0, sum: 0, items: [] },
    };
    rows.filter((r) => r.bucket === "vencido").forEach((r) => {
      const d = r.diasAtraso;
      const k = d <= 30 ? "b1" : d <= 60 ? "b2" : d <= 90 ? "b3" : d <= 180 ? "b4" : "b5";
      buckets[k].count += 1;
      buckets[k].sum += r.saldo;
      buckets[k].items.push(r);
    });
    return buckets;
  }, [rows]);

  // ---------- Fluxo de recebimentos (previsão) ----------
  const forecast = useMemo(() => {
    const m = new Map<string, number>(); // YYYY-MM -> valor a vencer
    rows.filter((r) => r.bucket === "pendente" || r.bucket === "vencido" || r.bucket === "parcial").forEach((r) => {
      const k = r.r.due_date.slice(0, 7);
      m.set(k, (m.get(k) || 0) + r.saldo);
    });
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ mes: k, valor: Number(v.toFixed(2)) }));
  }, [rows]);

  // ---------- Rankings ----------
  const ranking = useMemo(() => {
    return {
      maiorDivida: [...synthetic].sort((a, b) => b.saldo - a.saldo).slice(0, 20),
      maisFaturamento: [...synthetic].sort((a, b) => b.total - a.total).slice(0, 20),
      maisAtraso: rows
        .filter((r) => r.bucket === "vencido")
        .reduce((acc: { customer: Customer | null; dias: number; saldo: number }[], r) => {
          const cur = acc.find((x) => x.customer?.id === r.c?.id);
          if (cur) {
            cur.dias = Math.max(cur.dias, r.diasAtraso);
            cur.saldo += r.saldo;
          } else acc.push({ customer: r.c, dias: r.diasAtraso, saldo: r.saldo });
          return acc;
        }, [])
        .sort((a, b) => b.dias - a.dias).slice(0, 20),
    };
  }, [synthetic, rows]);

  // ---------- Gráficos dashboard ----------
  const chartByStatus = useMemo(() => {
    const c: Record<Bucket, number> = { pago: 0, parcial: 0, pendente: 0, vencido: 0 };
    rows.forEach((r) => (c[r.bucket] += r.saldo || r.paid));
    return [
      { name: "Pago", value: rows.reduce((s, r) => s + (r.bucket === "pago" ? Number(r.r.amount) : 0), 0), color: "#10b981" },
      { name: "Parcial", value: c.parcial, color: "#f59e0b" },
      { name: "A vencer", value: c.pendente, color: "#0ea5e9" },
      { name: "Vencido", value: c.vencido, color: "#f43f5e" },
    ];
  }, [rows]);

  const chartMensal = useMemo(() => {
    // recebimentos por mês (últimos 12)
    const m = new Map<string, number>();
    payments.forEach((p) => {
      const k = p.created_at.slice(0, 7);
      m.set(k, (m.get(k) || 0) + Number(p.amount_paid || 0));
    });
    const arr = Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    return arr.slice(-12).map(([mes, valor]) => ({ mes, valor: Number(valor.toFixed(2)) }));
  }, [payments]);

  // ---------- Ordenação analítico ----------
  const [sortKey, setSortKey] = useState<"vencimento" | "cliente" | "valor" | "saldo" | "atraso">("vencimento");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sortedAnalytic = useMemo(() => {
    const cp = [...rows];
    cp.sort((a, b) => {
      let x = 0;
      if (sortKey === "vencimento") x = a.r.due_date.localeCompare(b.r.due_date);
      if (sortKey === "cliente") x = (a.c?.name || "").localeCompare(b.c?.name || "");
      if (sortKey === "valor") x = Number(a.r.amount) - Number(b.r.amount);
      if (sortKey === "saldo") x = a.saldo - b.saldo;
      if (sortKey === "atraso") x = a.diasAtraso - b.diasAtraso;
      return sortDir === "asc" ? x : -x;
    });
    return cp;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  // ---------- Paginação analítico ----------
  const [page, setPage] = useState(1);
  const pageSize = 50;
  useEffect(() => setPage(1), [dSearch, statusFilter, from, to, minVal, maxVal, paymentFilter, dateField]);
  const paged = sortedAnalytic.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(sortedAnalytic.length / pageSize));

  // ---------- Exportações ----------
  function exportAnalyticExcel() {
    const data = sortedAnalytic.map((r) => ({
      Cliente: r.c?.name || "—",
      CPF_CNPJ: r.c?.tax_id || "",
      Telefone: r.c?.phone || "",
      Descrição: r.r.description || "",
      Emissão: r.r.created_at?.slice(0, 10) || "",
      Vencimento: r.r.due_date,
      "Dias em atraso": r.diasAtraso,
      "Valor original": Number(r.r.amount),
      Pago: Number(r.paid.toFixed(2)),
      Saldo: Number(r.saldo.toFixed(2)),
      Status: r.bucket,
      "Forma de pagamento": r.sale?.payment_method || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Analítico");
    XLSX.writeFile(wb, `contas-a-receber-analitico-${Date.now()}.xlsx`);
  }

  function exportAnalyticPdf() {
    const doc = new jsPDF("l", "mm", "a4");
    doc.setFontSize(14);
    doc.text("Contas a Receber — Analítico", 14, 14);
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      `${sortedAnalytic.length} lançamentos • Gerado em ${new Date().toLocaleString("pt-BR")}`,
      14, 20,
    );
    doc.setTextColor(0);
    autoTable(doc, {
      startY: 26,
      head: [["Cliente", "Vencimento", "Atraso", "Valor", "Pago", "Saldo", "Status"]],
      body: sortedAnalytic.map((r) => [
        r.c?.name || "—",
        fmt(r.r.due_date),
        r.diasAtraso ? `${r.diasAtraso}d` : "—",
        brl(Number(r.r.amount)),
        brl(r.paid),
        brl(r.saldo),
        r.bucket,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    });
    const y = (doc as any).lastAutoTable.finalY + 8;
    doc.setFont("helvetica", "bold");
    doc.text(`Total original: ${brl(kpis.totalOriginal)}`, 14, y);
    doc.text(`Recebido: ${brl(kpis.totalPago)}`, 80, y);
    doc.text(`Saldo em aberto: ${brl(kpis.totalAberto)}`, 150, y);
    doc.save(`contas-a-receber-analitico-${Date.now()}.pdf`);
  }

  function exportSyntheticExcel() {
    const data = synthetic.map((s) => ({
      Cliente: s.customer?.name || "—",
      CPF_CNPJ: s.customer?.tax_id || "",
      Telefone: s.customer?.phone || "",
      Parcelas: s.qtd,
      Total: Number(s.total.toFixed(2)),
      Recebido: Number(s.pago.toFixed(2)),
      "A vencer": Number(s.aberto.toFixed(2)),
      Vencido: Number(s.vencido.toFixed(2)),
      Saldo: Number(s.saldo.toFixed(2)),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sintético");
    XLSX.writeFile(wb, `contas-a-receber-sintetico-${Date.now()}.xlsx`);
  }

  // ---------- Render ----------
  return (
    <div className="space-y-4">
      <PageHeader
        title="Relatórios — Contas a Receber"
        description="Dashboard, analítico, sintético, inadimplência, ranking e fluxo de recebimentos."
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" /> Imprimir
            </Button>
            <Button variant="outline" onClick={exportAnalyticExcel}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
            </Button>
            <Button onClick={exportAnalyticPdf}>
              <Download className="h-4 w-4 mr-2" /> PDF
            </Button>
          </>
        }
      />

      {/* FILTROS */}
      <GlassCard>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="h-4 w-4 absolute left-2 top-3 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar cliente, apelido, CPF/CNPJ, telefone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={dateField} onValueChange={(v) => setDateField(v as DateField)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="due_date">Data: Vencimento</SelectItem>
              <SelectItem value="created_at">Data: Emissão</SelectItem>
              <SelectItem value="paid_at">Data: Recebimento</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="pendente">A vencer</SelectItem>
              <SelectItem value="vencido">Vencido</SelectItem>
              <SelectItem value="parcial">Parcial</SelectItem>
              <SelectItem value="pago">Pago</SelectItem>
            </SelectContent>
          </Select>

          <Input type="number" placeholder="Valor mín. (R$)" value={minVal} onChange={(e) => setMinVal(e.target.value)} />
          <Input type="number" placeholder="Valor máx. (R$)" value={maxVal} onChange={(e) => setMaxVal(e.target.value)} />
          <Select value={paymentFilter} onValueChange={setPaymentFilter}>
            <SelectTrigger><SelectValue placeholder="Forma pagamento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as formas</SelectItem>
              {paymentMethods.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="md:col-span-3 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => {
              setSearch(""); setFrom(""); setTo(""); setStatusFilter("todos");
              setMinVal(""); setMaxVal(""); setPaymentFilter("todos");
            }}>Limpar filtros</Button>
          </div>
        </div>
      </GlassCard>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<Wallet />} label="Total a Receber" value={brl(kpis.totalAberto)} tone="sky" />
        <KpiCard icon={<TrendingUp />} label="Recebido (histórico)" value={brl(kpis.totalPago)} tone="emerald" />
        <KpiCard icon={<AlertTriangle />} label="Vencido" value={brl(kpis.totalVencido)} tone="rose" />
        <KpiCard icon={<CalendarClock />} label="A Vencer" value={brl(kpis.totalAVencer)} tone="amber" />
        <KpiCard icon={<Users />} label="Inadimplentes" value={String(kpis.inadimplentes)} tone="rose" />
        <KpiCard icon={<PieIcon />} label="% Inadimplência" value={`${kpis.pctInad.toFixed(1)}%`} tone="rose" />
        <KpiCard label="Qtd. Títulos" value={String(kpis.qtd)} tone="sky" />
        <KpiCard label="Ticket Médio" value={brl(kpis.ticketMedio)} tone="emerald" />
        <KpiCard label="Valor Médio / Cliente" value={brl(kpis.valorMedioCliente)} tone="emerald" />
        <KpiCard label="Recebimentos Hoje" value={brl(kpis.recDay)} tone="emerald" />
        <KpiCard label="Recebimentos 7d" value={brl(kpis.recWeek)} tone="emerald" />
        <KpiCard label="Recebimentos 30d" value={brl(kpis.recMonth)} tone="emerald" />
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="analitico">Analítico</TabsTrigger>
          <TabsTrigger value="sintetico">Sintético</TabsTrigger>
          <TabsTrigger value="aging">Inadimplência</TabsTrigger>
          <TabsTrigger value="fluxo">Fluxo</TabsTrigger>
          <TabsTrigger value="ranking">Ranking</TabsTrigger>
        </TabsList>

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Recebimentos por mês</CardTitle></CardHeader>
              <CardContent style={{ height: 300 }}>
                <ResponsiveContainer>
                  <BarChart data={chartMensal}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mes" />
                    <YAxis />
                    <RTooltip formatter={(v: any) => brl(Number(v))} />
                    <Bar dataKey="valor" fill="#0ea5e9" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Saldo por status</CardTitle></CardHeader>
              <CardContent style={{ height: 300 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={chartByStatus} dataKey="value" nameKey="name" outerRadius={100} label={(e) => brl(Number(e.value))}>
                      {chartByStatus.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Legend />
                    <RTooltip formatter={(v: any) => brl(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Previsão de recebimento por mês (saldo em aberto)</CardTitle></CardHeader>
              <CardContent style={{ height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mes" />
                    <YAxis />
                    <RTooltip formatter={(v: any) => brl(Number(v))} />
                    <Line type="monotone" dataKey="valor" stroke="#8b5cf6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ANALÍTICO */}
        <TabsContent value="analitico">
          <GlassCard>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>
                      <button className="flex items-center gap-1" onClick={() => toggleSort("cliente")}>
                        Cliente <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead>CPF/CNPJ</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>
                      <button className="flex items-center gap-1" onClick={() => toggleSort("vencimento")}>
                        Vencimento <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort("atraso")}>
                        Atraso <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort("valor")}>
                        Valor <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">
                      <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort("saldo")}>
                        Saldo <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">Carregando…</TableCell></TableRow>
                  )}
                  {!loading && paged.map((r) => (
                    <TableRow
                      key={r.r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => r.c && setStatementCustomer(r.c)}
                    >
                      <TableCell className="font-medium">{r.c?.name || "—"}</TableCell>
                      <TableCell>{r.c?.tax_id || "—"}</TableCell>
                      <TableCell>{r.c?.phone || "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{r.r.description || "—"}</TableCell>
                      <TableCell>{fmt(r.r.due_date)}</TableCell>
                      <TableCell className="text-right">{r.diasAtraso ? `${r.diasAtraso}d` : "—"}</TableCell>
                      <TableCell className="text-right">{brl(Number(r.r.amount))}</TableCell>
                      <TableCell className="text-right">{brl(r.paid)}</TableCell>
                      <TableCell className="text-right font-medium">{brl(r.saldo)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={bucketColor[r.bucket]}>{r.bucket}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && !paged.length && (
                    <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">Nenhum lançamento com esses filtros.</TableCell></TableRow>
                  )}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={6} className="text-right font-semibold">Totais dos filtros:</TableCell>
                    <TableCell className="text-right font-semibold">{brl(kpis.totalOriginal)}</TableCell>
                    <TableCell className="text-right font-semibold">{brl(kpis.totalPago)}</TableCell>
                    <TableCell className="text-right font-semibold">{brl(kpis.totalAberto)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
            <div className="flex items-center justify-between mt-3 text-sm">
              <div className="text-muted-foreground">
                {sortedAnalytic.length} lançamento(s) • Página {page}/{totalPages}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
              </div>
            </div>
          </GlassCard>
        </TabsContent>

        {/* SINTÉTICO */}
        <TabsContent value="sintetico">
          <GlassCard>
            <div className="flex justify-end mb-2">
              <Button size="sm" variant="outline" onClick={exportSyntheticExcel}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Parcelas</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Recebido</TableHead>
                    <TableHead className="text-right">A vencer</TableHead>
                    <TableHead className="text-right">Vencido</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {synthetic.map((s, i) => (
                    <TableRow
                      key={s.customer?.id ?? `x${i}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => s.customer && setStatementCustomer(s.customer)}
                    >
                      <TableCell className="font-medium">{s.customer?.name || "—"}</TableCell>
                      <TableCell className="text-right">{s.qtd}</TableCell>
                      <TableCell className="text-right">{brl(s.total)}</TableCell>
                      <TableCell className="text-right">{brl(s.pago)}</TableCell>
                      <TableCell className="text-right">{brl(s.aberto)}</TableCell>
                      <TableCell className="text-right text-rose-600">{brl(s.vencido)}</TableCell>
                      <TableCell className="text-right font-semibold">{brl(s.saldo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </GlassCard>
        </TabsContent>

        {/* AGING */}
        <TabsContent value="aging" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(aging).map(([k, v]) => (
              <Card key={k}>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{v.label}</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-rose-600">{brl(v.sum)}</div>
                  <div className="text-xs text-muted-foreground">{v.count} título(s)</div>
                </CardContent>
              </Card>
            ))}
          </div>
          {Object.entries(aging).map(([k, v]) => v.items.length > 0 && (
            <GlassCard key={k}>
              <h3 className="font-semibold mb-2">{v.label} — {brl(v.sum)}</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead className="text-right">Dias</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {v.items.map((r) => (
                      <TableRow key={r.r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => r.c && setStatementCustomer(r.c)}>
                        <TableCell>{r.c?.name || "—"}</TableCell>
                        <TableCell>{r.c?.phone || "—"}</TableCell>
                        <TableCell>{fmt(r.r.due_date)}</TableCell>
                        <TableCell className="text-right">{r.diasAtraso}d</TableCell>
                        <TableCell className="text-right font-semibold">{brl(r.saldo)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </GlassCard>
          ))}
        </TabsContent>

        {/* FLUXO */}
        <TabsContent value="fluxo">
          <GlassCard>
            <div style={{ height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={forecast}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" />
                  <YAxis />
                  <RTooltip formatter={(v: any) => brl(Number(v))} />
                  <Bar dataKey="valor" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Mês</TableHead><TableHead className="text-right">Previsão</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {forecast.map((f) => (
                  <TableRow key={f.mes}><TableCell>{f.mes}</TableCell><TableCell className="text-right">{brl(f.valor)}</TableCell></TableRow>
                ))}
                {!forecast.length && (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">Sem valores em aberto.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </GlassCard>
        </TabsContent>

        {/* RANKING */}
        <TabsContent value="ranking" className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <GlassCard>
            <h3 className="font-semibold mb-2">Top 20 — Maior Saldo Devedor</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
              <TableBody>
                {ranking.maiorDivida.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>{s.customer?.name || "—"}</TableCell>
                    <TableCell className="text-right">{brl(s.saldo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold mb-2">Top 20 — Maior Faturamento</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {ranking.maisFaturamento.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>{s.customer?.name || "—"}</TableCell>
                    <TableCell className="text-right">{brl(s.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold mb-2">Top 20 — Maior Atraso</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead className="text-right">Dias</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
              <TableBody>
                {ranking.maisAtraso.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>{s.customer?.name || "—"}</TableCell>
                    <TableCell className="text-right">{s.dias}d</TableCell>
                    <TableCell className="text-right">{brl(s.saldo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </GlassCard>
        </TabsContent>
      </Tabs>

      <CustomerStatementDialog
        customer={statementCustomer}
        onClose={() => setStatementCustomer(null)}
        rows={rowsAll.filter((r) => r.c?.id === statementCustomer?.id)}
        payments={payments.filter((p) =>
          rowsAll.some((r) => r.r.id === p.receivable_id && r.c?.id === statementCustomer?.id),
        )}
      />
    </div>
  );
}

// ---------- KPI card ----------
function KpiCard({
  icon, label, value, tone,
}: { icon?: React.ReactNode; label: string; value: string; tone: "sky" | "emerald" | "amber" | "rose" }) {
  const toneCls = {
    sky: "text-sky-600",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
  }[tone];
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          {icon && <span className={toneCls}>{icon}</span>}
        </div>
        <div className={`text-xl font-bold ${toneCls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ---------- Statement Dialog ----------
function CustomerStatementDialog({
  customer, onClose, rows, payments,
}: {
  customer: Customer | null;
  onClose: () => void;
  rows: { r: Receivable; paid: number; saldo: number; bucket: Bucket }[];
  payments: Payment[];
}) {
  const events = useMemo(() => {
    if (!customer) return [];
    const arr: { date: string; kind: "titulo" | "pagamento"; label: string; value: number }[] = [];
    rows.forEach((r) => {
      arr.push({
        date: r.r.created_at.slice(0, 10),
        kind: "titulo",
        label: `Título ${r.r.description || ""} — venc. ${fmt(r.r.due_date)}`,
        value: Number(r.r.amount),
      });
    });
    payments.forEach((p) => {
      arr.push({
        date: p.created_at.slice(0, 10),
        kind: "pagamento",
        label: `Recebimento`,
        value: -Number(p.amount_paid || 0),
      });
    });
    arr.sort((a, b) => a.date.localeCompare(b.date));
    let saldo = 0;
    return arr.map((e) => {
      saldo += e.value;
      return { ...e, saldo };
    });
  }, [rows, payments, customer]);

  const totalTit = rows.reduce((s, r) => s + Number(r.r.amount), 0);
  const totalPag = rows.reduce((s, r) => s + r.paid, 0);
  const saldo = totalTit - totalPag;

  return (
    <Dialog open={!!customer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Extrato — {customer?.name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 text-sm mb-2">
          <div className="p-2 rounded bg-muted/50">Títulos: <b>{brl(totalTit)}</b></div>
          <div className="p-2 rounded bg-muted/50">Recebido: <b className="text-emerald-600">{brl(totalPag)}</b></div>
          <div className="p-2 rounded bg-muted/50">Saldo: <b className="text-rose-600">{brl(saldo)}</b></div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Movimentação</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e, i) => (
                <TableRow key={i}>
                  <TableCell>{fmt(e.date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={e.kind === "titulo" ? "bg-sky-500/15 text-sky-600" : "bg-emerald-500/15 text-emerald-600"}>
                      {e.kind}
                    </Badge>{" "}
                    {e.label}
                  </TableCell>
                  <TableCell className={`text-right ${e.value < 0 ? "text-emerald-600" : ""}`}>{brl(e.value)}</TableCell>
                  <TableCell className="text-right font-medium">{brl(e.saldo)}</TableCell>
                </TableRow>
              ))}
              {!events.length && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem movimentações.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
