import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, MessageCircle, ShoppingBag, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_OPTS = [
  { v: "aguardando_aprovacao", l: "Aguardando aprovação" },
  { v: "aguardando_compra", l: "Aguardando compra" },
  { v: "em_compra", l: "Em compra" },
  { v: "recebido", l: "Produto recebido" },
  { v: "pronto_entrega", l: "Pronto para entrega" },
  { v: "finalizado", l: "Finalizado" },
  { v: "cancelado", l: "Cancelado" },
];

export default function PreSaleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ps, setPs] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!id) return;
    const [{ data: p }, { data: it }] = await Promise.all([
      supabase.from("pre_sales").select("*,customer:customers(name,phone)").eq("id", id).maybeSingle(),
      supabase.from("pre_sale_items").select("*").eq("pre_sale_id", id).order("created_at"),
    ]);
    setPs(p);
    setItems((it as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const updateStatus = async (status: string) => {
    const { error } = await supabase.from("pre_sales").update({ status: status as any }).eq("id", id!);
    if (error) return toast.error(error.message);
    toast.success("Status atualizado");
    load();
  };

  const sendWhatsApp = async () => {
    if (!ps?.customer?.phone) return toast.error("Cliente sem telefone");
    const lines = items.map(i =>
      `• ${i.quantity}× ${i.description}${i.size ? ` (${i.size})` : ""}${i.color ? ` ${i.color}` : ""} — R$ ${Number(i.subtotal).toFixed(2)}`
    ).join("\n");
    const txt = `Olá ${ps.customer.name}! Segue sua pré-venda:\n\n${lines}\n\n*Total: R$ ${Number(ps.total).toFixed(2)}*\n\nPosso confirmar? 💖`;
    const phone = ps.customer.phone.replace(/\D/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(txt)}`, "_blank");
    await supabase.from("pre_sales").update({ whatsapp_sent_at: new Date().toISOString() }).eq("id", id!);
  };

  const convertToSale = async () => {
    if (!ps) return;
    if (items.some(i => !i.product_id)) {
      return toast.error("Há itens sem produto. Cadastre antes de converter.");
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: sale, error } = await supabase.from("sales").insert({
        customer_id: ps.customer_id,
        total: ps.total,
        notes: `Convertida da pré-venda ${ps.id.slice(0, 8)}`,
      }).select().single();
      if (error) throw error;
      const payload = items.map(i => ({
        sale_id: sale.id,
        product_id: i.product_id,
        variant_id: i.variant_id,
        product_name: i.description,
        variant_label: [i.size, i.color].filter(Boolean).join("/") || null,
        quantity: i.quantity,
        unit_price: i.unit_price,
        unit_cost: 0,
      }));
      const { error: ie } = await supabase.from("sale_items").insert(payload);
      if (ie) throw ie;
      await supabase.from("pre_sales").update({ status: "finalizado" }).eq("id", id!);
      toast.success("Convertida em venda!");
      navigate(`/vendas`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao converter");
    }
  };

  const remove = async () => {
    if (!confirm("Excluir esta pré-venda?")) return;
    const { error } = await supabase.from("pre_sales").delete().eq("id", id!);
    if (error) return toast.error(error.message);
    navigate("/pre-vendas");
  };

  if (loading) return <div className="container py-6">Carregando...</div>;
  if (!ps) return <div className="container py-6">Pré-venda não encontrada.</div>;

  return (
    <div className="container mx-auto py-6 px-4 max-w-3xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/pre-vendas")} className="mb-2">
        <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
      </Button>

      <PageHeader
        title={ps.customer?.name ?? "Sem cliente"}
        description={format(new Date(ps.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
        actions={
          <Button variant="ghost" size="icon" onClick={remove}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        }
      />

      <GlassCard className="mb-4 flex items-center gap-3">
        <div className="text-xs text-muted-foreground">Status:</div>
        <Select value={ps.status} onValueChange={updateStatus}>
          <SelectTrigger className="w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTS.map(s => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
          </SelectContent>
        </Select>
      </GlassCard>

      <div className="space-y-2 mb-4">
        {items.map(i => (
          <GlassCard key={i.id} className="!p-3">
            <div className="flex gap-3">
              {i.photo_url && <img src={i.photo_url} alt="" className="h-16 w-16 rounded object-cover" />}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{i.description}</div>
                <div className="text-xs text-muted-foreground">
                  {[i.size, i.color, i.supplier].filter(Boolean).join(" · ")}
                </div>
                {!i.product_id && <Badge variant="outline" className="mt-1 text-[10px]">não cadastrado</Badge>}
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">{i.quantity}× R$ {Number(i.unit_price).toFixed(2)}</div>
                <div className="font-bold">R$ {Number(i.subtotal).toFixed(2)}</div>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="mb-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Total</div>
        <div className="text-2xl font-bold">R$ {Number(ps.total).toFixed(2)}</div>
      </GlassCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button variant="outline" size="lg" onClick={sendWhatsApp}>
          <MessageCircle className="h-4 w-4 mr-2" /> Enviar no WhatsApp
        </Button>
        <Button size="lg" onClick={convertToSale} disabled={ps.status === "finalizado"}>
          <ShoppingBag className="h-4 w-4 mr-2" /> Converter em venda
        </Button>
      </div>
    </div>
  );
}
