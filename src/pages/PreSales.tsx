import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, ScanLine } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  aguardando_aprovacao: { label: "Aguardando aprovação", variant: "secondary" },
  aguardando_compra: { label: "Aguardando compra", variant: "outline" },
  em_compra: { label: "Em compra", variant: "outline" },
  recebido: { label: "Recebido", variant: "default" },
  pronto_entrega: { label: "Pronto p/ entrega", variant: "default" },
  finalizado: { label: "Finalizado", variant: "default" },
  cancelado: { label: "Cancelado", variant: "destructive" },
};

interface PreSale {
  id: string;
  status: string;
  total: number;
  created_at: string;
  notes: string | null;
  customer: { name: string; phone: string | null } | null;
}

export default function PreSales() {
  const [items, setItems] = useState<PreSale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("pre_sales")
        .select("id,status,total,created_at,notes,customer:customers(name,phone)")
        .order("created_at", { ascending: false })
        .limit(100);
      setItems((data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  const totals = items.reduce(
    (acc, x) => {
      acc.count++;
      acc.value += Number(x.total) || 0;
      if (x.status === "finalizado") acc.done++;
      return acc;
    },
    { count: 0, value: 0, done: 0 },
  );

  return (
    <div className="container mx-auto py-6 px-4">
      <PageHeader
        title="Pré-Vendas"
        description="Escaneie etiquetas e monte vendas em segundos"
        actions={
          <Button asChild size="lg">
            <Link to="/pre-vendas/nova">
              <Plus className="h-4 w-4 mr-2" />
              Nova Pré-Venda
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <GlassCard className="!p-4">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-2xl font-bold">{totals.count}</div>
        </GlassCard>
        <GlassCard className="!p-4">
          <div className="text-xs text-muted-foreground">Valor total</div>
          <div className="text-2xl font-bold">R$ {totals.value.toFixed(2)}</div>
        </GlassCard>
        <GlassCard className="!p-4">
          <div className="text-xs text-muted-foreground">Ticket médio</div>
          <div className="text-2xl font-bold">
            R$ {totals.count ? (totals.value / totals.count).toFixed(2) : "0,00"}
          </div>
        </GlassCard>
        <GlassCard className="!p-4">
          <div className="text-xs text-muted-foreground">Conversão</div>
          <div className="text-2xl font-bold">
            {totals.count ? Math.round((totals.done / totals.count) * 100) : 0}%
          </div>
        </GlassCard>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : items.length === 0 ? (
        <GlassCard className="text-center py-12">
          <ScanLine className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <div className="font-medium mb-1">Nenhuma pré-venda ainda</div>
          <div className="text-sm text-muted-foreground mb-4">
            Comece escaneando uma etiqueta com a câmera do celular.
          </div>
          <Button asChild>
            <Link to="/pre-vendas/nova">
              <Plus className="h-4 w-4 mr-2" />
              Criar primeira pré-venda
            </Link>
          </Button>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {items.map((s) => {
            const st = STATUS_LABELS[s.status] ?? { label: s.status, variant: "outline" as const };
            return (
              <Link
                key={s.id}
                to={`/pre-vendas/${s.id}`}
                className="block glass-card p-4 hover:scale-[1.01] transition-transform"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {s.customer?.name ?? "Sem cliente"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(s.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold">R$ {Number(s.total).toFixed(2)}</div>
                    <Badge variant={st.variant} className="mt-1 text-[10px]">
                      {st.label}
                    </Badge>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
