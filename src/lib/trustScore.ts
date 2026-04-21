// Cálculo do score de confiança do cliente
// Baseado em histórico de contas a receber: pontualidade, atrasos, dívidas vencidas em aberto.

export interface ReceivableLike {
  id: string;
  amount: number | string;
  due_date: string; // YYYY-MM-DD
  status: "pendente" | "pago" | "atrasado" | string;
  paid_at: string | null;
}

export interface TrustReport {
  score: number;            // 0-100
  level: "novo" | "excelente" | "bom" | "atenção" | "crítico";
  label: string;            // texto curto para badge
  totalCount: number;       // qtd lançamentos
  paidOnTime: number;
  paidLate: number;
  openOverdue: number;
  openPending: number;
  worstOverdueDays: number; // maior atraso atual em dias
  totalOverdueAmount: number;
  reasoning: string[];      // explicações curtas
}

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const dayDiff = (a: Date, b: Date) =>
  Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));

export function calculateTrust(receivables: ReceivableLike[]): TrustReport {
  const reasoning: string[] = [];

  if (!receivables || receivables.length === 0) {
    return {
      score: 100,
      level: "novo",
      label: "Novo cliente",
      totalCount: 0,
      paidOnTime: 0,
      paidLate: 0,
      openOverdue: 0,
      openPending: 0,
      worstOverdueDays: 0,
      totalOverdueAmount: 0,
      reasoning: ["Sem histórico de compras ainda."],
    };
  }

  let score = 100;
  let paidOnTime = 0;
  let paidLate = 0;
  let openOverdue = 0;
  let openPending = 0;
  let worstOverdueDays = 0;
  let totalOverdueAmount = 0;
  let totalLateDays = 0;

  const now = today();

  for (const r of receivables) {
    const due = new Date(r.due_date + "T00:00:00");
    const amount = Number(r.amount) || 0;

    if (r.status === "pago" && r.paid_at) {
      const paidAt = new Date(r.paid_at);
      paidAt.setHours(0, 0, 0, 0);
      const diff = dayDiff(paidAt, due);
      if (diff <= 0) {
        paidOnTime++;
        score += 1; // bônus suave por pontualidade
      } else {
        paidLate++;
        totalLateDays += diff;
        // -2 pts por dia de atraso na quitação, máx -15 por lançamento
        score -= Math.min(15, 2 + diff * 2);
      }
    } else {
      // ainda em aberto
      if (now > due) {
        const overdueDays = dayDiff(now, due);
        openOverdue++;
        worstOverdueDays = Math.max(worstOverdueDays, overdueDays);
        totalOverdueAmount += amount;
        // -3 pts por dia de atraso atual, máx -40 por lançamento
        score -= Math.min(40, 5 + overdueDays * 3);
      } else {
        openPending++;
      }
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Mensagens
  if (paidOnTime > 0) reasoning.push(`${paidOnTime} pagamento(s) em dia`);
  if (paidLate > 0) reasoning.push(`${paidLate} pagamento(s) com atraso (média ${Math.round(totalLateDays / paidLate)} dias)`);
  if (openOverdue > 0) reasoning.push(`${openOverdue} dívida(s) vencida(s) em aberto — pior: ${worstOverdueDays} dias`);
  if (openPending > 0) reasoning.push(`${openPending} pagamento(s) pendente(s) no prazo`);

  let level: TrustReport["level"];
  let label: string;
  if (score >= 90) { level = "excelente"; label = "Excelente"; }
  else if (score >= 70) { level = "bom"; label = "Bom"; }
  else if (score >= 40) { level = "atenção"; label = "Atenção"; }
  else { level = "crítico"; label = "Crítico"; }

  return {
    score,
    level,
    label,
    totalCount: receivables.length,
    paidOnTime,
    paidLate,
    openOverdue,
    openPending,
    worstOverdueDays,
    totalOverdueAmount,
    reasoning,
  };
}

export const trustColor = (level: TrustReport["level"]) => {
  switch (level) {
    case "excelente": return "text-success";
    case "bom": return "text-primary";
    case "atenção": return "text-warning";
    case "crítico": return "text-destructive";
    default: return "text-muted-foreground";
  }
};

export const trustBgClass = (level: TrustReport["level"]) => {
  switch (level) {
    case "excelente": return "bg-success/15 text-success border-success/30";
    case "bom": return "bg-primary/15 text-primary border-primary/30";
    case "atenção": return "bg-warning/20 text-warning-foreground border-warning/40";
    case "crítico": return "bg-destructive/15 text-destructive border-destructive/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
};
