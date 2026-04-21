import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const fmtBRL = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (iso: string) => {
  try {
    return format(parseISO(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return iso;
  }
};

interface ReceivableRow {
  customers?: { name: string } | null;
  description: string | null;
  amount: number;
  due_date: string;
  status: string;
}

interface PayableRow {
  supplier: string;
  description: string | null;
  category: string | null;
  amount: number;
  due_date: string;
  status: string;
}

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

function totalsBlock(rows: { amount: number; status: string }[]) {
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const byStatus: Record<string, { count: number; sum: number }> = {};
  rows.forEach((r) => {
    const k = r.status || "—";
    byStatus[k] = byStatus[k] || { count: 0, sum: 0 };
    byStatus[k].count += 1;
    byStatus[k].sum += Number(r.amount);
  });
  return { total, byStatus };
}

export function exportReceivablePdf(rows: ReceivableRow[], filterLabel: string) {
  const doc = new jsPDF();
  const now = format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR });
  header(
    doc,
    "Contas a Receber",
    `Filtro: ${filterLabel} • ${rows.length} lançamento(s) • Gerado em ${now}`
  );

  autoTable(doc, {
    startY: 28,
    head: [["Cliente", "Descrição", "Vencimento", "Status", "Valor"]],
    body: rows.map((r) => [
      r.customers?.name ?? "—",
      r.description ?? "—",
      fmtDate(r.due_date),
      r.status,
      fmtBRL(Number(r.amount)),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    columnStyles: { 4: { halign: "right" } },
    didDrawPage: (data) => {
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
    },
  });

  const { total, byStatus } = totalsBlock(rows);
  const finalY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Resumo", 14, finalY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let y = finalY + 6;
  Object.entries(byStatus).forEach(([k, v]) => {
    doc.text(`${k}: ${v.count} • ${fmtBRL(v.sum)}`, 14, y);
    y += 5;
  });
  doc.setFont("helvetica", "bold");
  doc.text(`Total geral: ${fmtBRL(total)}`, 14, y + 2);

  doc.save(`contas-a-receber-${Date.now()}.pdf`);
}

export function exportPayablePdf(rows: PayableRow[], filterLabel: string) {
  const doc = new jsPDF();
  const now = format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR });
  header(
    doc,
    "Contas a Pagar",
    `Filtro: ${filterLabel} • ${rows.length} lançamento(s) • Gerado em ${now}`
  );

  autoTable(doc, {
    startY: 28,
    head: [["Fornecedor", "Descrição", "Categoria", "Vencimento", "Status", "Valor"]],
    body: rows.map((r) => [
      r.supplier,
      r.description ?? "—",
      r.category ?? "—",
      fmtDate(r.due_date),
      r.status,
      fmtBRL(Number(r.amount)),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    columnStyles: { 5: { halign: "right" } },
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
    },
  });

  const { total, byStatus } = totalsBlock(rows);
  const finalY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Resumo", 14, finalY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let y = finalY + 6;
  Object.entries(byStatus).forEach(([k, v]) => {
    doc.text(`${k}: ${v.count} • ${fmtBRL(v.sum)}`, 14, y);
    y += 5;
  });
  doc.setFont("helvetica", "bold");
  doc.text(`Total geral: ${fmtBRL(total)}`, 14, y + 2);

  doc.save(`contas-a-pagar-${Date.now()}.pdf`);
}
