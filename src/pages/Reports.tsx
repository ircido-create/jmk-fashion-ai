import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { formatTaxId, digitsOnly } from "@/lib/taxId";
import { fetchAll } from "@/lib/fetchAll";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Download, FileSpreadsheet, Printer, Search, User as UserIcon, FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

type Customer = {
  id: string; name: string; nickname: string | null; tax_id: string | null;
  phone: string | null; email: string | null; address: string | null; created_at: string;
};
type SaleItem = { id: string; sale_id: string; product_name: string; quantity: number; unit_price: number; variant_label: string | null };
type Sale = {
  id: string; customer_id: string | null; sale_date: string; total: number;
  payment_method: string | null; installments: number | null; notes: string | null; created_at: string;
};
type Receivable = {
  id: string; customer_id: string | null; amount: number; due_date: string;
  status: string; paid_at: string | null; description: string | null; created_at: string;
};
type Payment = { id: string; receivable_id: string; amount_paid: number; created_at: string; proof_id: string };
type Proof = { id: string; payment_date: string; description: string | null };

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const fmtDate = (d: string | null | undefined) => (d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("pt-BR") : "—");

type StatusBucket = "pago" | "parcial" | "pendente" | "vencido";
function receivableStatus(r: Receivable, paidSum: number): StatusBucket {
  if (r.status === "pago" || paidSum + 0.005 >= r.amount) return "pago";
  const today = new Date().toISOString().slice(0, 10);
  if (paidSum > 0.005) return "parcial";
  if (r.due_date < today) return "vencido";
  return "pendente";
}
const statusColor: Record<StatusBucket, string> = {
  pago: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  parcial: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  pendente: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  vencido: "bg-rose-500/15 text-rose-600 border-rose-500/30",
};

export default function Reports() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [proofs, setProofs] = useState<Record<string, Proof>>({});

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [onlyOpen, setOnlyOpen] = useState(false);

  // Carrega lista de clientes uma vez
  useEffect(() => {
    (async () => {
      const rows = await fetchAll<Customer>((sb) =>
        sb.from("customers").select("id, name, nickname, tax_id, phone, email, address, created_at").order("name")
      );
      setCustomers(rows);
    })();
  }, []);

  // Ao selecionar cliente, carrega dados
  useEffect(() => {
    if (!selected) return;
    (async () => {
      setLoading(true);
      try {
        const [salesRes, recRes] = await Promise.all([
          supabase.from("sales").select("id, customer_id, sale_date, total, payment_method, installments, notes, created_at")
            .eq("customer_id", selected.id).order("sale_date", { ascending: false }),
          supabase.from("accounts_receivable").select("id, customer_id, amount, due_date, status, paid_at, description, created_at")
            .eq("customer_id", selected.id).order("due_date", { ascending: true }),
        ]);
        if (salesRes.error) throw salesRes.error;
        if (recRes.error) throw recRes.error;
        const salesArr = (salesRes.data ?? []) as Sale[];
        const recArr = (recRes.data ?? []) as Receivable[];
        setSales(salesArr);
        setReceivables(recArr);

        const saleIds = salesArr.map((s) => s.id);
        const recIds = recArr.map((r) => r.id);
        const [itemsRes, payRes] = await Promise.all([
          saleIds.length
            ? supabase.from("sale_items").select("id, sale_id, product_name, quantity, unit_price, variant_label").in("sale_id", saleIds)
            : Promise.resolve({ data: [], error: null } as any),
          recIds.length
            ? supabase.from("receivable_payments").select("id, receivable_id, amount_paid, created_at, proof_id").in("receivable_id", recIds)
            : Promise.resolve({ data: [], error: null } as any),
        ]);
        setItems((itemsRes.data ?? []) as SaleItem[]);
        const pays = (payRes.data ?? []) as Payment[];
        setPayments(pays);

        const proofIds = Array.from(new Set(pays.map((p) => p.proof_id).filter(Boolean)));
        if (proofIds.length) {
          const { data } = await supabase.from("payment_proofs").select("id, payment_date, description").in("id", proofIds);
          const map: Record<string, Proof> = {};
          (data ?? []).forEach((p: any) => (map[p.id] = p));
          setProofs(map);
        } else setProofs({});
      } catch (e: any) {
        toast.error(e.message ?? "Erro ao carregar dados");
      } finally {
        setLoading(false);
      }
    })();
  }, [selected]);

  const filteredSales = useMemo(
    () => sales.filter((s) => (!from || s.sale_date >= from) && (!to || s.sale_date <= to)),
    [sales, from, to]
  );

  const paidByReceivable = useMemo(() => {
    const m = new Map<string, number>();
    payments.forEach((p) => m.set(p.receivable_id, (m.get(p.receivable_id) ?? 0) + Number(p.amount_paid)));
    return m;
  }, [payments]);

  const filteredReceivables = useMemo(() => {
    return receivables.filter((r) => {
      if (from && r.due_date < from) return false;
      if (to && r.due_date > to) return false;
      if (onlyOpen) {
        const paid = paidByReceivable.get(r.id) ?? 0;
        if (receivableStatus(r, paid) === "pago") return false;
      }
      return true;
    });
  }, [receivables, from, to, onlyOpen, paidByReceivable]);

  const itemsBySale = useMemo(() => {
    const m = new Map<string, SaleItem[]>();
    items.forEach((it) => {
      const arr = m.get(it.sale_id) ?? [];
      arr.push(it);
      m.set(it.sale_id, arr);
    });
    return m;
  }, [items]);

  const totalsPurchases = useMemo(() => {
    const salesTotal = filteredSales.reduce((s, x) => s + Number(x.total), 0);
    const salesDates = filteredSales.map((s) => s.sale_date);
    const qtyItems = filteredSales.reduce((s, x) => s + (itemsBySale.get(x.id) ?? []).reduce((a, it) => a + Number(it.quantity), 0), 0);

    // Fallback: quando não há registro em `sales`, tratamos os receivables como compras.
    // Agrupamos por data de criação (yyyy-mm-dd) para inferir "pedidos".
    const linkedReceivableIds = new Set(filteredSales.map((s: any) => s.receivable_id).filter(Boolean));
    const orphanReceivables = filteredReceivables.filter((r) => !linkedReceivableIds.has(r.id));
    const receivableTotal = orphanReceivables.reduce((s, r) => s + Number(r.amount), 0);
    const receivableDates = orphanReceivables.map((r) => r.created_at.slice(0, 10));
    const orderGroups = new Set(receivableDates);

    const totalBought = salesTotal + receivableTotal;
    const orders = filteredSales.length + orderGroups.size;
    const allDates = [...salesDates, ...receivableDates].sort();
    const first = allDates[0] ?? null;
    const last = allDates[allDates.length - 1] ?? null;

    return {
      orders,
      totalBought,
      avgTicket: orders ? totalBought / orders : 0,
      qtyItems,
      first, last,
    };
  }, [filteredSales, filteredReceivables, itemsBySale]);

  const totalsFinance = useMemo(() => {
    const totalBilled = filteredReceivables.reduce((s, r) => s + Number(r.amount), 0);
    let totalPaid = 0, totalOpen = 0, totalOverdue = 0;
    const today = new Date().toISOString().slice(0, 10);
    filteredReceivables.forEach((r) => {
      const paid = paidByReceivable.get(r.id) ?? 0;
      totalPaid += paid;
      const rest = Math.max(0, Number(r.amount) - paid);
      totalOpen += rest;
      if (rest > 0.005 && r.due_date < today) totalOverdue += rest;
    });
    return { totalBilled, totalPaid, totalOpen, totalOverdue };
  }, [filteredReceivables, paidByReceivable]);

  const lastPurchase = totalsPurchases.last;
  const daysWithout = lastPurchase ? Math.floor((Date.now() - new Date(lastPurchase + "T00:00:00").getTime()) / 86400000) : null;
  const isActive = daysWithout !== null && daysWithout <= 90;

  // Extrato cronológico
  type StatementRow = { date: string; kind: "compra" | "pagamento"; desc: string; debit: number; credit: number };
  const statement = useMemo<StatementRow[]>(() => {
    const rows: StatementRow[] = [];
    filteredSales.forEach((s) => rows.push({
      date: s.sale_date, kind: "compra",
      desc: `Venda #${s.id.slice(0, 8)} · ${s.payment_method ?? "—"}${s.installments ? ` (${s.installments}x)` : ""}`,
      debit: Number(s.total), credit: 0,
    }));
    payments.forEach((p) => {
      const r = receivables.find((x) => x.id === p.receivable_id);
      const pf = proofs[p.proof_id];
      const d = pf?.payment_date ?? p.created_at.slice(0, 10);
      if (from && d < from) return;
      if (to && d > to) return;
      rows.push({
        date: d, kind: "pagamento",
        desc: `Baixa parcela venc. ${r ? fmtDate(r.due_date) : "—"}`,
        debit: 0, credit: Number(p.amount_paid),
      });
    });
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return rows;
  }, [filteredSales, payments, receivables, proofs, from, to]);

  const statementWithBalance = useMemo(() => {
    let bal = 0;
    return statement.map((r) => { bal += r.debit - r.credit; return { ...r, balance: bal }; });
  }, [statement]);

  // Gráfico mensal
  const monthly = useMemo(() => {
    const m = new Map<string, { month: string; compras: number; pagamentos: number }>();
    const key = (d: string) => d.slice(0, 7);
    filteredSales.forEach((s) => {
      const k = key(s.sale_date);
      const e = m.get(k) ?? { month: k, compras: 0, pagamentos: 0 };
      e.compras += Number(s.total); m.set(k, e);
    });
    payments.forEach((p) => {
      const pf = proofs[p.proof_id];
      const d = pf?.payment_date ?? p.created_at.slice(0, 10);
      if (from && d < from) return;
      if (to && d > to) return;
      const k = key(d);
      const e = m.get(k) ?? { month: k, compras: 0, pagamentos: 0 };
      e.pagamentos += Number(p.amount_paid); m.set(k, e);
    });
    return Array.from(m.values()).sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [filteredSales, payments, proofs, from, to]);

  const topProducts = useMemo(() => {
    const m = new Map<string, number>();
    filteredSales.forEach((s) =>
      (itemsBySale.get(s.id) ?? []).forEach((it) => m.set(it.product_name, (m.get(it.product_name) ?? 0) + Number(it.quantity)))
    );
    return Array.from(m.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [filteredSales, itemsBySale]);

  const paymentMethods = useMemo(() => {
    const m = new Map<string, number>();
    filteredSales.forEach((s) => m.set(s.payment_method ?? "—", (m.get(s.payment_method ?? "—") ?? 0) + Number(s.total)));
    return Array.from(m.entries()).map(([method, total]) => ({ method, total })).sort((a, b) => b.total - a.total);
  }, [filteredSales]);

  // Busca no picker
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 50);
    const qd = digitsOnly(q);
    return customers
      .filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true;
        if ((c.nickname ?? "").toLowerCase().includes(q)) return true;
        if (qd && digitsOnly(c.tax_id ?? "").includes(qd)) return true;
        if (qd && digitsOnly(c.phone ?? "").includes(qd)) return true;
        return false;
      })
      .slice(0, 50);
  }, [customers, pickerQuery]);

  // ==== Exportações ====
  function exportPDF() {
    if (!selected) return;
    const doc = new jsPDF();
    const now = new Date().toLocaleString("pt-BR");
    doc.setFontSize(16); doc.text("Relatório do Cliente", 14, 16);
    doc.setFontSize(10); doc.text(`Gerado em ${now}`, 14, 22);
    doc.setFontSize(11);
    doc.text(`Cliente: ${selected.name}`, 14, 30);
    if (selected.nickname) doc.text(`Apelido: ${selected.nickname}`, 14, 36);
    doc.text(`CPF/CNPJ: ${formatTaxId(selected.tax_id) || "—"}`, 14, 42);
    doc.text(`Telefone: ${selected.phone ?? "—"}`, 14, 48);
    doc.text(`E-mail: ${selected.email ?? "—"}`, 14, 54);
    doc.text(`Endereço: ${selected.address ?? "—"}`, 14, 60);

    autoTable(doc, {
      startY: 68,
      head: [["Indicador", "Valor"]],
      body: [
        ["Total comprado", brl(totalsPurchases.totalBought)],
        ["Pedidos", String(totalsPurchases.orders)],
        ["Ticket médio", brl(totalsPurchases.avgTicket)],
        ["Total pago", brl(totalsFinance.totalPaid)],
        ["Saldo devedor", brl(totalsFinance.totalOpen)],
        ["Total vencido", brl(totalsFinance.totalOverdue)],
        ["Última compra", fmtDate(totalsPurchases.last ?? undefined)],
        ["Dias sem comprar", daysWithout === null ? "—" : String(daysWithout)],
      ],
    });

    autoTable(doc, {
      head: [["Data", "Venda", "Pagamento", "Parcelas", "Total"]],
      body: filteredSales.map((s) => [
        fmtDate(s.sale_date), `#${s.id.slice(0, 8)}`, s.payment_method ?? "—",
        s.installments ? `${s.installments}x` : "1x", brl(Number(s.total)),
      ]),
      didDrawPage: (data) => {
        doc.setFontSize(12); doc.text("Compras", 14, data.settings.startY! - 4);
      },
    });

    autoTable(doc, {
      head: [["Vencimento", "Valor", "Pago", "Saldo", "Status"]],
      body: filteredReceivables.map((r) => {
        const paid = paidByReceivable.get(r.id) ?? 0;
        const st = receivableStatus(r, paid);
        return [fmtDate(r.due_date), brl(Number(r.amount)), brl(paid), brl(Math.max(0, Number(r.amount) - paid)), st];
      }),
      didDrawPage: (data) => {
        doc.setFontSize(12); doc.text("Financeiro", 14, data.settings.startY! - 4);
      },
    });

    doc.save(`relatorio-${selected.name.replace(/\s+/g, "_")}.pdf`);
  }

  function exportExcel() {
    if (!selected) return;
    const wb = XLSX.utils.book_new();
    const wsInfo = XLSX.utils.aoa_to_sheet([
      ["Cliente", selected.name],
      ["Apelido", selected.nickname ?? ""],
      ["CPF/CNPJ", formatTaxId(selected.tax_id) || ""],
      ["Telefone", selected.phone ?? ""],
      ["E-mail", selected.email ?? ""],
      ["Endereço", selected.address ?? ""],
      [],
      ["Total comprado", totalsPurchases.totalBought],
      ["Pedidos", totalsPurchases.orders],
      ["Ticket médio", totalsPurchases.avgTicket],
      ["Total pago", totalsFinance.totalPaid],
      ["Saldo devedor", totalsFinance.totalOpen],
      ["Total vencido", totalsFinance.totalOverdue],
    ]);
    XLSX.utils.book_append_sheet(wb, wsInfo, "Resumo");

    const wsCompras = XLSX.utils.json_to_sheet(filteredSales.map((s) => ({
      Data: s.sale_date, Venda: s.id.slice(0, 8),
      Produtos: (itemsBySale.get(s.id) ?? []).map((it) => `${it.quantity}x ${it.product_name}`).join(" | "),
      Pagamento: s.payment_method ?? "", Parcelas: s.installments ?? 1, Total: Number(s.total),
    })));
    XLSX.utils.book_append_sheet(wb, wsCompras, "Compras");

    const wsFin = XLSX.utils.json_to_sheet(filteredReceivables.map((r) => {
      const paid = paidByReceivable.get(r.id) ?? 0;
      return {
        Vencimento: r.due_date, Valor: Number(r.amount), Pago: paid,
        Saldo: Math.max(0, Number(r.amount) - paid), Status: receivableStatus(r, paid),
        "Quitado em": r.paid_at ?? "",
      };
    }));
    XLSX.utils.book_append_sheet(wb, wsFin, "Financeiro");

    const wsExt = XLSX.utils.json_to_sheet(statementWithBalance.map((r) => ({
      Data: r.date, Tipo: r.kind, Descrição: r.desc,
      Débito: r.debit || "", Crédito: r.credit || "", Saldo: r.balance,
    })));
    XLSX.utils.book_append_sheet(wb, wsExt, "Extrato");

    XLSX.writeFile(wb, `relatorio-${selected.name.replace(/\s+/g, "_")}.xlsx`);
  }

  function exportCSV() {
    if (!selected) return;
    const rows = [
      ["Data", "Tipo", "Descrição", "Débito", "Crédito", "Saldo"],
      ...statementWithBalance.map((r) => [
        r.date, r.kind, r.desc,
        r.debit ? r.debit.toFixed(2) : "",
        r.credit ? r.credit.toFixed(2) : "",
        r.balance.toFixed(2),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `extrato-${selected.name.replace(/\s+/g, "_")}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 print:space-y-2">
      <PageHeader title="Relatórios de Clientes" description="Compras, pagamentos e extrato consolidados por cliente." />

      <Card className="print:hidden">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <label className="text-xs text-muted-foreground">Cliente</label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <Search className="h-4 w-4 mr-2" />
                  {selected ? selected.name : "Buscar por nome, CPF/CNPJ ou telefone..."}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[380px]" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Digite..." value={pickerQuery} onValueChange={setPickerQuery} />
                  <CommandList>
                    <CommandEmpty>Nenhum cliente</CommandEmpty>
                    <CommandGroup>
                      {pickerResults.map((c) => (
                        <CommandItem key={c.id} onSelect={() => { setSelected(c); setPickerOpen(false); }}>
                          <div className="flex flex-col">
                            <span className="font-medium">{c.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatTaxId(c.tax_id) || "sem CPF"} · {c.phone ?? "sem telefone"}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <input id="only-open" type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            <label htmlFor="only-open" className="text-sm">Somente em aberto</label>
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={exportPDF} disabled={!selected}><FileText className="h-4 w-4 mr-1" />PDF</Button>
            <Button size="sm" variant="outline" onClick={exportExcel} disabled={!selected}><FileSpreadsheet className="h-4 w-4 mr-1" />Excel</Button>
            <Button size="sm" variant="outline" onClick={exportCSV} disabled={!selected}><Download className="h-4 w-4 mr-1" />CSV</Button>
            <Button size="sm" variant="outline" onClick={() => window.print()} disabled={!selected}><Printer className="h-4 w-4 mr-1" />Imprimir</Button>
          </div>
        </CardContent>
      </Card>

      {!selected ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">
          <UserIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Selecione um cliente para ver o relatório.
        </CardContent></Card>
      ) : loading ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Carregando...</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                {selected.name}
                <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Ativo" : "Inativo"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div className="text-muted-foreground text-xs">CPF/CNPJ</div><div>{formatTaxId(selected.tax_id) || "—"}</div></div>
              <div><div className="text-muted-foreground text-xs">Telefone</div><div>{selected.phone ?? "—"}</div></div>
              <div><div className="text-muted-foreground text-xs">E-mail</div><div className="truncate">{selected.email ?? "—"}</div></div>
              <div><div className="text-muted-foreground text-xs">Endereço</div><div className="truncate">{selected.address ?? "—"}</div></div>
              <div><div className="text-muted-foreground text-xs">Apelido</div><div>{selected.nickname ?? "—"}</div></div>
              <div><div className="text-muted-foreground text-xs">Código</div><div className="font-mono text-xs">{selected.id.slice(0, 8)}</div></div>
              <div><div className="text-muted-foreground text-xs">Cadastrado em</div><div>{fmtDate(selected.created_at.slice(0, 10))}</div></div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Total comprado" value={brl(totalsPurchases.totalBought)} />
            <Kpi label="Total pago" value={brl(totalsFinance.totalPaid)} />
            <Kpi label="Saldo devedor" value={brl(totalsFinance.totalOpen)} accent={totalsFinance.totalOpen > 0 ? "warn" : undefined} />
            <Kpi label="Total vencido" value={brl(totalsFinance.totalOverdue)} accent={totalsFinance.totalOverdue > 0 ? "danger" : undefined} />
            <Kpi label="Pedidos" value={String(totalsPurchases.orders)} />
            <Kpi label="Ticket médio" value={brl(totalsPurchases.avgTicket)} />
            <Kpi label="Última compra" value={fmtDate(totalsPurchases.last ?? undefined)} />
            <Kpi label="Dias sem comprar" value={daysWithout === null ? "—" : String(daysWithout)} />
          </div>

          <Tabs defaultValue="compras">
            <TabsList>
              <TabsTrigger value="compras">Compras</TabsTrigger>
              <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
              <TabsTrigger value="extrato">Extrato</TabsTrigger>
              <TabsTrigger value="graficos">Gráficos</TabsTrigger>
            </TabsList>

            <TabsContent value="compras">
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Data</TableHead><TableHead>Venda</TableHead>
                      <TableHead>Produtos</TableHead><TableHead>Pagamento</TableHead>
                      <TableHead className="text-right">Parcelas</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {filteredSales.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{fmtDate(s.sale_date)}</TableCell>
                          <TableCell className="font-mono text-xs">#{s.id.slice(0, 8)}</TableCell>
                          <TableCell className="max-w-[380px]">
                            <div className="text-xs space-y-0.5">
                              {(itemsBySale.get(s.id) ?? []).map((it) => (
                                <div key={it.id}>{it.quantity}× {it.product_name}{it.variant_label ? ` (${it.variant_label})` : ""} — {brl(Number(it.unit_price))}</div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>{s.payment_method ?? "—"}</TableCell>
                          <TableCell className="text-right">{s.installments ? `${s.installments}x` : "1x"}</TableCell>
                          <TableCell className="text-right font-medium">{brl(Number(s.total))}</TableCell>
                        </TableRow>
                      ))}
                      {filteredSales.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem compras no período.</TableCell></TableRow>}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={2}>Totais</TableCell>
                        <TableCell colSpan={2} className="text-xs text-muted-foreground">
                          {totalsPurchases.qtyItems} itens · primeira {fmtDate(totalsPurchases.first ?? undefined)} · última {fmtDate(totalsPurchases.last ?? undefined)}
                        </TableCell>
                        <TableCell className="text-right">{totalsPurchases.orders} ped.</TableCell>
                        <TableCell className="text-right font-semibold">{brl(totalsPurchases.totalBought)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="financeiro">
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Pago</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead>Quitado em</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {filteredReceivables.map((r) => {
                        const paid = paidByReceivable.get(r.id) ?? 0;
                        const st = receivableStatus(r, paid);
                        const bal = Math.max(0, Number(r.amount) - paid);
                        return (
                          <TableRow key={r.id}>
                            <TableCell>{fmtDate(r.due_date)}</TableCell>
                            <TableCell className="max-w-[280px] truncate text-xs">{r.description ?? "—"}</TableCell>
                            <TableCell className="text-right">{brl(Number(r.amount))}</TableCell>
                            <TableCell className="text-right">{brl(paid)}</TableCell>
                            <TableCell className="text-right font-medium">{brl(bal)}</TableCell>
                            <TableCell>{fmtDate(r.paid_at ?? undefined)}</TableCell>
                            <TableCell><Badge variant="outline" className={statusColor[st]}>{st}</Badge></TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredReceivables.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sem parcelas no período.</TableCell></TableRow>}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={2}>Totais</TableCell>
                        <TableCell className="text-right">{brl(totalsFinance.totalBilled)}</TableCell>
                        <TableCell className="text-right">{brl(totalsFinance.totalPaid)}</TableCell>
                        <TableCell className="text-right font-semibold">{brl(totalsFinance.totalOpen)}</TableCell>
                        <TableCell colSpan={2} className="text-right text-rose-600">vencido: {brl(totalsFinance.totalOverdue)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="extrato">
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Débito</TableHead><TableHead className="text-right">Crédito</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {statementWithBalance.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{fmtDate(r.date)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={r.kind === "compra" ? "bg-sky-500/10 text-sky-600 border-sky-500/30" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"}>
                              {r.kind}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{r.desc}</TableCell>
                          <TableCell className="text-right">{r.debit ? brl(r.debit) : ""}</TableCell>
                          <TableCell className="text-right">{r.credit ? brl(r.credit) : ""}</TableCell>
                          <TableCell className="text-right font-medium">{brl(r.balance)}</TableCell>
                        </TableRow>
                      ))}
                      {statementWithBalance.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem movimentos.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="graficos">
              <div className="grid gap-3 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Compras × Pagamentos por mês</CardTitle></CardHeader>
                  <CardContent className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthly}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="month" fontSize={11} />
                        <YAxis fontSize={11} tickFormatter={(v) => `R$${Math.round(v / 1000)}k`} />
                        <RTooltip formatter={(v: number) => brl(v)} />
                        <Bar dataKey="compras" fill="hsl(var(--primary))" />
                        <Bar dataKey="pagamentos" fill="hsl(var(--chart-2, 142 71% 45%))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm">Produtos mais comprados</CardTitle></CardHeader>
                  <CardContent className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topProducts} layout="vertical" margin={{ left: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis type="number" fontSize={11} />
                        <YAxis type="category" dataKey="name" fontSize={10} width={140} />
                        <RTooltip />
                        <Bar dataKey="qty" fill="hsl(var(--primary))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card className="md:col-span-2">
                  <CardHeader><CardTitle className="text-sm">Formas de pagamento</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead>Forma</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {paymentMethods.map((p) => (
                          <TableRow key={p.method}><TableCell>{p.method}</TableCell><TableCell className="text-right">{brl(p.total)}</TableCell></TableRow>
                        ))}
                        {paymentMethods.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-4">—</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "warn" | "danger" }) {
  const cls = accent === "danger" ? "text-rose-600" : accent === "warn" ? "text-amber-600" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold ${cls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
