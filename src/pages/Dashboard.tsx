import ReactMarkdown from 'react-markdown';
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import {
  ShoppingCart, Calendar, Wallet, AlertTriangle, Eye, EyeOff, FileDown, Loader2, WifiOff,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { generateDashboardReport, DashboardReportKey } from "@/lib/dashboardReports";
import { todaySP, monthStartSP, toSaoPauloDate } from "@/lib/tz";


interface Stats {
  customers: number;
  products: number;
  receivable: number;
  payable: number;
  overdue: number;
  overdueAmount: number;
  overdueMonth: number;
  overdueMonthCount: number;
  lowStock: number;
  salesToday: number;
  salesMonth: number;
  receivedMonth: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    customers: 0, products: 0, receivable: 0, payable: 0, overdue: 0, overdueAmount: 0, overdueMonth: 0, overdueMonthCount: 0, lowStock: 0,
    salesToday: 0, salesMonth: 0, receivedMonth: 0,
  });
  const [chart, setChart] = useState<{ month: string; receber: number; pagar: number }[]>([]);
  const [showValues, setShowValues] = useState(true);
  const [reporting, setReporting] = useState<DashboardReportKey | null>(null);
  const [lastInboundAt, setLastInboundAt] = useState<string | null>(null);
  const [inboundChecked, setInboundChecked] = useState(false);

  const [avgDelayMin, setAvgDelayMin] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("whatsapp_messages")
      .select("created_at")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setLastInboundAt((data as any)?.created_at ?? null);
        setInboundChecked(true);
      });

    supabase
      .from("whatsapp_messages")
      .select("created_at, sent_at")
      .eq("direction", "inbound")
      .not("sent_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const rows = (data ?? []) as { created_at: string; sent_at: string }[];
        setAvgDelayMin(
          rows.length
            ? rows.reduce((s, r) => s + (new Date(r.created_at).getTime() - new Date(r.sent_at).getTime()) / 60000, 0) / rows.length
            : null,
        );
      });
  }, []);

  const hoursSinceInbound = lastInboundAt
    ? (Date.now() - new Date(lastInboundAt).getTime()) / 3600000
    : null;
  const whatsappInactive = inboundChecked && (hoursSinceInbound === null || hoursSinceInbound > 6);
  const whatsappDelayed = avgDelayMin !== null && avgDelayMin > 15;


  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const today = todaySP();
    const monthStart = monthStartSP();
    const [c, p, r, ap, od, odm, ls, salesRows, receivedRows] = await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true }),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true),
      fetchAll<{ amount: number }>((sb) => sb.from("accounts_receivable").select("amount").in("status", ["pendente", "vencido"])),
      fetchAll<{ amount: number }>((sb) => sb.from("accounts_payable").select("amount").in("status", ["pendente", "vencido"])),
      fetchAll<{ amount: number }>((sb) => sb.from("accounts_receivable").select("amount").in("status", ["pendente", "vencido"]).lt("due_date", today)),
      fetchAll<{ amount: number; due_date: string }>((sb) => sb.from("accounts_receivable").select("amount, due_date").eq("status", "vencido").gte("due_date", monthStart)),
      fetchAll<any>((sb) => sb.from("product_variants").select("quantity, products!inner(low_stock_threshold)")),
      fetchAll<{ total: number; sale_date: string }>((sb) => sb.from("sales").select("total, sale_date")),
      fetchAll<{ amount_paid: number; created_at: string }>((sb) => sb.from("receivable_payments").select("amount_paid, created_at")),
    ]);

    const lowStock = ls.filter((v: any) => v.quantity <= (v.products?.low_stock_threshold ?? 5)).length;

    const salesToday = salesRows
      .filter((s) => toSaoPauloDate(s.sale_date) === today)
      .reduce((sum, s) => sum + Number(s.total), 0);
    const salesMonth = salesRows
      .filter((s) => toSaoPauloDate(s.sale_date) >= monthStart)
      .reduce((sum, s) => sum + Number(s.total), 0);
    const receivedMonth = receivedRows
      .filter((p) => toSaoPauloDate(p.created_at) >= monthStart)
      .reduce((sum, p) => sum + Number(p.amount_paid), 0);

    const overdueMonth = odm.reduce((s, x) => s + Number(x.amount), 0);
    const overdueMonthCount = odm.length;

    setStats({
      customers: c.count ?? 0,
      products: p.count ?? 0,
      receivable: r.reduce((s, x) => s + Number(x.amount), 0),
      payable: ap.reduce((s, x) => s + Number(x.amount), 0),
      overdue: od.length,
      overdueAmount: od.reduce((s, x) => s + Number(x.amount), 0),
      overdueMonth,
      overdueMonthCount,
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
    { key: "salesToday" as DashboardReportKey, label: "Vendas do Dia", value: showValues ? brl(stats.salesToday) : maskBrl(), sub: "Hoje", icon: ShoppingCart, gradient: "from-emerald-400 to-teal-500" },
    { key: "salesMonth" as DashboardReportKey, label: "Vendas do Mês", value: showValues ? brl(stats.salesMonth) : maskBrl(), sub: format(new Date(), "MMMM", { locale: ptBR }), icon: Calendar, gradient: "from-violet-400 to-purple-500" },
    { key: "receivedMonth" as DashboardReportKey, label: "Recebido no Mês", value: showValues ? brl(stats.receivedMonth) : maskBrl(), sub: "Pagamentos", icon: Wallet, gradient: "from-sky-400 to-cyan-500" },
    { key: "overdueMonth" as DashboardReportKey, label: "Atrasados do Mês", value: showValues ? brl(stats.overdueMonth) : maskBrl(), sub: `${stats.overdueMonthCount} título(s)`, icon: AlertTriangle, gradient: "from-amber-400 to-orange-500" },
  ];

  const handleReport = async (key: DashboardReportKey, label: string) => {
    setReporting(key);
    try {
      await generateDashboardReport(key);
      toast.success("Relatório gerado com sucesso!");
    } catch (e: any) {
      console.error(e);
      toast.error("Falha ao gerar o relatório. Tente novamente.");
    } finally {
      setReporting(null);
    }
  };

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

      {whatsappInactive && (
        <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/10 backdrop-blur p-4 mb-6 flex gap-3 items-start">
          <WifiOff className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-destructive">WhatsApp possivelmente desconectado</p>
            <p className="text-xs text-muted-foreground mt-1">
              {lastInboundAt
                ? `Nenhuma mensagem recebida há ${Math.floor(hoursSinceInbound!)}h.`
                : "Nenhuma mensagem recebida até agora."}{" "}
              Abra <strong>WhatsApp + IA</strong> e clique em “Verificar conexão”.
            </p>
          </div>
        </div>
      )}

      {whatsappDelayed && (
        <div className="rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 backdrop-blur p-4 mb-6 flex gap-3 items-start">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-700 dark:text-amber-400">Mensagens do WhatsApp com atraso</p>
            <p className="text-xs text-muted-foreground mt-1">
              As últimas mensagens chegaram em média{" "}
              <strong>
                {avgDelayMin! >= 60 ? `${(avgDelayMin! / 60).toFixed(1)} h` : `${Math.round(avgDelayMin!)} min`}
              </strong>{" "}
              depois de enviadas — fila do provedor BubbleWhats.
            </p>
          </div>
        </div>
      )}




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
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => handleReport(c.key, c.label)}
                disabled={reporting !== null}
                aria-label={`Gerar relatório detalhado para ${c.label}`}
                title="Gerar relatório"
              >
                {reporting === c.key ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FileDown className="h-4 w-4" aria-hidden />
                )}
              </Button>
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
      <GlassCard className="mt-6 overflow-auto max-h-[600px] prose dark:prose-invert max-w-none">
        <ReactMarkdown>{`## Relatório de Execução: Cobranças Não Enviadas

### Descrição do Problema

Foi identificada uma execução manual do processo de cobrança que, apesar de reportar sucesso, não resultou no envio de nenhuma mensagem aos clientes. A auditoria dos logs indica que nenhuma conta foi analisada, levando à ausência de ações de cobrança.

### Detalhes da Execução

*   **Última Execução:** 22/08/2026, 10:00:07 (Manual)
*   **Status Registrado:**
    \`\`\`
    0 enviada(s), 0 falha(s), de 0 conta(s) analisada(s).
    \`\`\`

### Comportamento Observado

O sistema informa que o processo foi executado e concluído sem erros, mas **nenhuma mensagem de cobrança foi efetivamente enviada**. O número de contas analisadas é zero, o que sugere que o critério de seleção ou a base de dados de clientes elegíveis não foi acessada ou estava vazia no momento da execução.

### Comportamento Esperado

Após a execução manual do processo de cobrança, esperava-se que:
1.  Contas de clientes elegíveis fossem identificadas.
2.  Mensagens de cobrança fossem geradas e enviadas para essas contas.
3.  O status de execução refletisse o número real de mensagens enviadas e/ou falhas.

### Impacto

A não emissão das cobranças pode resultar em:
*   Perda de receita para a empresa.
*   Desalinhamento nos processos financeiros.
*   Impacto na experiência do cliente (cobranças tardias ou inesperadas).

### Pontos de Análise e Melhorias (UI/UX e Web Design)

Para investigar a causa raiz e evitar futuras ocorrências, solicitamos a análise dos seguintes pontos, com foco em usabilidade e feedback do usuário:

1.  **Validação de Entradas/Critérios de Seleção (UI):**
    *   **Contexto:** Por que \`0 conta(s) analisada(s)\`? Isso pode indicar que os critérios de filtro aplicados pelo usuário (se houver) resultaram em um conjunto vazio de clientes, ou que a fonte de dados estava indisponível.
    *   **Ação:**
        *   Verificar se a interface de usuário para configurar e iniciar o processo de cobrança (filtros de data, status, grupos de clientes, etc.) é clara e intuitiva.
        *   Implementar validações na UI para alertar o usuário **antes** da execução se os critérios selecionados resultarem em zero contas elegíveis (ex: "Atenção: Com os filtros atuais, nenhuma conta será processada. Deseja continuar?").
        *   Garantir que a interface exiba claramente os critérios que foram utilizados na execução manual.

2.  **Feedback Visual e Logging Detalhado (UI/Backend):**
    *   **Contexto:** A mensagem "0 enviada(s), 0 falha(s), de 0 conta(s) analisada(s)" é ambígua. Não informa *por que* zero contas foram analisadas.
    *   **Ação:**
        *   Melhorar o log de execução para incluir detalhes sobre o **motivo** de zero contas terem sido analisadas (ex: "Nenhuma conta encontrada com dívidas pendentes", "Filtro de grupo de clientes 'X' resultou em zero clientes").
        *   No relatório de execução visível ao usuário na UI, exibir uma mensagem mais informativa nesses casos, como "Processo concluído, mas nenhuma cobrança gerada. Motivo: [Detalhe do log aqui]".
        *   Considerar a exibição de um "relatório detalhado" acessível via UI que mostre quais contas foram consideradas, quais foram filtradas e por quê.

3.  **Disponibilidade e Integridade dos Dados (Backend/UI):**
    *   **Contexto:** Verificar se a base de dados de clientes e suas respectivas pendências de cobrança estavam acessíveis e íntegras no momento da execução.
    *   **Ação:**
        *   Implementar verificações de integridade de dados e conectividade na rotina de cobrança.
        *   Em caso de falha de acesso a dados críticos, o sistema deve registrar um erro explícito e informar o usuário através da UI (ex: "Falha ao acessar dados de clientes. Por favor, tente novamente ou contate o suporte.").

4.  **Permissões de Usuário e Escopo (UI/Backend):**
    *   **Contexto:** Confirmar se o usuário que realizou a execução manual possui todas as permissões necessárias para acessar as contas e disparar as cobranças.
    *   **Ação:**
        *   Garantir que as ações de UI para disparar cobranças estejam desabilitadas ou apresentem uma mensagem clara se o usuário não tiver as permissões adequadas.

### Próximos Passos

1.  **Análise de Logs:** Aprofundar a análise dos logs do sistema para identificar a causa exata de "0 conta(s) analisada(s)".
2.  **Revisão do Código:** Inspecionar a lógica de seleção de clientes e geração de cobranças para garantir que ela esteja funcionando conforme o esperado.
3.  **Melhorias de Feedback:** Planejar e implementar as melhorias de UI/UX para proporcionar maior clareza e feedback útil ao usuário durante e após as execuções do processo de cobrança.`}</ReactMarkdown>
      </GlassCard>
    </div>
  );
}
