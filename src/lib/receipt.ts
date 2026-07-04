// Utilitário para gerar/imprimir Cupom Não-Fiscal (80mm)

export type ReceiptPayment = "dinheiro" | "pix" | "debito" | "credito" | "fiado" | string;

export interface ReceiptItem {
  productName: string;
  variantLabel?: string | null;
  quantity: number;
  unitPrice: number;
}

export interface ReceiptData {
  number: string;
  date: Date;
  customer?: { name: string; phone?: string | null } | null;
  items: ReceiptItem[];
  subtotal: number;
  payment: ReceiptPayment;
  installments?: number;
  cashReceived?: number;
  change?: number;
  reprint?: boolean;
}

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  debito: "Cartão de Débito",
  credito: "Cartão de Crédito",
  fiado: "Fiado (Carnê)",
};

const fmtBRL = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function buildReceiptHtml(r: ReceiptData): string {
  const paymentLabel = PAYMENT_LABELS[r.payment] ?? r.payment ?? "—";
  const inst = r.installments ?? 1;

  const itemsRows = r.items
    .map(
      (it) => `
      <tr>
        <td>${escapeHtml(it.productName)}${it.variantLabel ? ` (${escapeHtml(it.variantLabel)})` : ""}<br/>
          ${it.quantity} x ${fmtBRL(it.unitPrice)}
        </td>
        <td class="right">${fmtBRL(it.unitPrice * it.quantity)}</td>
      </tr>`
    )
    .join("");

  const customerBlock = r.customer
    ? `<div>Cliente: ${escapeHtml(r.customer.name)}</div>
       ${r.customer.phone ? `<div>Tel: ${escapeHtml(r.customer.phone)}</div>` : ""}
       <div class="sep"></div>`
    : "";

  let paymentExtra = "";
  if (r.payment === "credito" && inst > 1) {
    paymentExtra = `<div>${inst}x de ${fmtBRL(r.subtotal / inst)}</div>`;
  } else if (r.payment === "dinheiro" && (r.cashReceived ?? 0) > 0) {
    paymentExtra = `
      <div class="row"><span>Recebido:</span><span>${fmtBRL(r.cashReceived ?? 0)}</span></div>
      <div class="row"><span>Troco:</span><span>${fmtBRL(r.change ?? 0)}</span></div>`;
  } else if (r.payment === "fiado") {
    paymentExtra =
      (inst > 1 ? `<div>${inst}x de ${fmtBRL(r.subtotal / inst)}</div>` : "") +
      `<div>Lançado na carteira do cliente.</div>`;
  }

  return `
    <div class="center">
      <div class="bold" style="font-size:14px">JMK MODA</div>
      <div>Cupom Não-Fiscal</div>
      <div>Nº ${escapeHtml(r.number)}</div>
      <div>${r.date.toLocaleString("pt-BR")}</div>
      ${r.reprint ? `<div class="bold">** REIMPRESSÃO **</div>` : ""}
    </div>
    <div class="sep"></div>
    ${customerBlock}
    <table>
      <tbody>${itemsRows}</tbody>
    </table>
    <div class="sep"></div>
    <div class="row bold" style="font-size:13px">
      <span>TOTAL</span><span>${fmtBRL(r.subtotal)}</span>
    </div>
    <div class="sep"></div>
    <div>Pagamento: ${escapeHtml(paymentLabel)}</div>
    ${paymentExtra}
    <div class="sep"></div>
    <div class="center">Obrigado pela preferência!</div>
  `;
}

export function printReceipt(r: ReceiptData): boolean {
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) return false;
  const html = buildReceiptHtml(r);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cupom ${r.number}</title>
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
  return true;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
