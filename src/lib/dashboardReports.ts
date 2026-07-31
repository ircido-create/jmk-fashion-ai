import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { fetchAll } from "@/lib/fetchAll";

export type DashboardReportKey = "salesToday" | "salesMonth" | "receivedMonth" | "overdueMonth";

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (iso: string) => {
  try {
    return format(parseISO(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return iso ?? "—";
  }
};

function header(doc: jsPDF, title: string, subtitle: string) {
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text(subtitle, 14, 22);
  doc.setTextColor(0);
}

type Summary = { head: string[]; body: (string | number)[][]; title: string };

function build(
  title: string,
  subtitle: string,
  head: string[],
  body: (string | number)[][],
  total: number,
  filename: string,
  summary?: Summary
) {
  const doc = new jsPDF();
  header(doc, title, subtitle);

  let startY = 28;

  if (summary && summary.body.length) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(summary.title, 14, startY);
    autoTable(doc, {
      startY: startY + 3,
      head: [summary.head],
      body: summary.body,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [22, 101, 52], textColor: 255 },
      columnStyles: { [summary.head.length - 1]: { halign: "right" } },
    });
    startY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Detalhamento", 14, startY);
    startY += 3;
  }

  autoTable(doc, {
    startY,
    head: [head],
    body: body.length ? body : [head.map((_, i) => (i === 0 ? "Nenhum registro encontrado" : ""))],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    columnStyles: { [head.length - 1]: { halign: "right" } },
    didDrawPage: () => {
      const pageNum = doc.getCurrentPageInfo().pageNumber;
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(
        `Página ${pageNum} / ${pageCount}`,
        doc.internal.pageSize.getWidth() - 14,
        doc.internal.pageSize.getHeight() - 8,
        { align: "right" }
      );
      doc.setTextColor(0);
    },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 10;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${brl(total)}  •  ${body.length} registro(s)`, 14, finalY);

  doc.save(filename);
}

/** Agrupa registros por cliente somando os valores (maior total primeiro). */
function summarizeByCustomer(
  rows: { name: string; amount: number }[],
  valueLabel: string
): Summary {
  const map = new Map<string, { qty: number; total: number }>();
  for (const r of rows) {
    const key = r.name || "—";
    const cur = map.get(key) ?? { qty: 0, total: 0 };
    cur.qty += 1;
    cur.total += Number(r.amount || 0);
    map.set(key, cur);
  }
  const body = [...map.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, v]) => [name, v.qty, brl(v.total)]);
  return { title: "Resumo por cliente (total)", head: ["Cliente", "Títulos", valueLabel], body };
}

export async function generateDashboardReport(key: DashboardReportKey) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = startOfMonth(now).toISOString().slice(0, 10);
  const stamp = format(now, "yyyy-MM-dd", { locale: ptBR });
  const generated = `Gerado em ${format(now, "dd/MM/yyyy HH:mm", { locale: ptBR })}`;

  if (key === "salesToday" || key === "salesMonth") {
    const isDay = key === "salesToday";
    const rows = await fetchAll<any>((sb) =>
      sb
        .from("sales")
        .select("total, sale_date, payment_method, installments, notes, customers(name, nickname)")
        .gte("sale_date", isDay ? today : monthStart)
        .order("sale_date", { ascending: true })
    );
    const filtered = rows.filter((r) =>
      isDay ? String(r.sale_date).slice(0, 10) === today : true
    );
    const total = filtered.reduce((s, r) => s + Number(r.total || 0), 0);
    build(
      isDay ? "Relatório de Vendas do Dia" : "Relatório de Vendas do Mês",
      `${isDay ? fmtDate(today) : format(now, "MMMM 'de' yyyy", { locale: ptBR })} • ${generated}`,
      ["Data", "Cliente", "Pagamento", "Parcelas", "Valor"],
      filtered.map((r) => [
        fmtDate(String(r.sale_date).slice(0, 10)),
        r.customers?.name ?? r.customers?.nickname ?? "Consumidor",
        r.payment_method ?? "—",
        r.installments ?? 1,
        brl(Number(r.total)),
      ]),
      total,
      `Relatorio_${isDay ? "Vendas_Dia" : "Vendas_Mes"}_${stamp}.pdf`,
      summarizeByCustomer(
        filtered.map((r) => ({
          name: r.customers?.name ?? r.customers?.nickname ?? "Consumidor",
          amount: Number(r.total || 0),
        })),
        "Total"
      )
    );
    return;
  }

  if (key === "receivedMonth") {
    const rows = await fetchAll<any>((sb) =>
      sb
        .from("receivable_payments")
        .select("amount_paid, created_at, accounts_receivable(description, due_date, customers(name))")
        .gte("created_at", monthStart)
        .order("created_at", { ascending: true })
    );
    const total = rows.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
    build(
      "Relatório de Recebimentos do Mês",
      `${format(now, "MMMM 'de' yyyy", { locale: ptBR })} • ${generated}`,
      ["Data", "Cliente", "Descrição", "Vencimento", "Valor pago"],
      rows.map((r) => [
        fmtDate(String(r.created_at).slice(0, 10)),
        r.accounts_receivable?.customers?.name ?? "—",
        r.accounts_receivable?.description ?? "—",
        r.accounts_receivable?.due_date ? fmtDate(r.accounts_receivable.due_date) : "—",
        brl(Number(r.amount_paid)),
      ]),
      total,
      `Relatorio_Recebido_Mes_${stamp}.pdf`,
      summarizeByCustomer(
        rows.map((r) => ({
          name: r.accounts_receivable?.customers?.name ?? "—",
          amount: Number(r.amount_paid || 0),
        })),
        "Total pago"
      )
    );
    return;
  }

  const rows = await fetchAll<any>((sb) =>
    sb
      .from("accounts_receivable")
      .select("amount, due_date, description, status, customers(name, phone)")
      .eq("status", "vencido")
      .gte("due_date", monthStart)
      .order("due_date", { ascending: true })
  );
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  build(
    "Relatório de Atrasados do Mês",
    `${format(now, "MMMM 'de' yyyy", { locale: ptBR })} • ${generated}`,
    ["Vencimento", "Cliente", "Telefone", "Descrição", "Valor"],
    rows.map((r) => [
      fmtDate(r.due_date),
      r.customers?.name ?? "—",
      r.customers?.phone ?? "—",
      r.description ?? "—",
      brl(Number(r.amount)),
    ]),
    total,
    `Relatorio_Atrasados_Mes_${stamp}.pdf`,
    summarizeByCustomer(
      rows.map((r) => ({ name: r.customers?.name ?? "—", amount: Number(r.amount || 0) })),
      "Total devido"
    )
  );
}
