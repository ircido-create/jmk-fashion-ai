import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2, Copy, CreditCard, ExternalLink, Link2, Loader2, MessageCircle, PackageCheck, RefreshCw, Save, Store, Truck, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL } from "@/lib/utils";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type Status = "novo" | "confirmado" | "entregue" | "cancelado";

interface OrderItem {
  id: string;
  product_name: string;
  size: string | null;
  color: string | null;
  quantity: number;
  unit_price: number;
}

interface Order {
  id: string;
  code: string;
  status: Status;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  delivery_method: "retirada" | "entrega";
  address: Record<string, string> | null;
  notes: string | null;
  total: number;
  created_at: string;
  sale_id: string | null;
  store_order_items: OrderItem[];
}

interface Charge {
  id: string;
  order_id: string;
  status: string;
  link_url: string | null;
  link_expires_at: string | null;
  paid_at: string | null;
  paid_cents: number | null;
  last_error: string | null;
}

const CHARGE_LABEL: Record<string, string> = {
  rascunho: "Link não gerado",
  aguardando: "Aguardando pagamento",
  pago: "Pago no link",
  estornado: "Estornado",
  cancelado: "Cancelado",
  expirado: "Link expirado",
  falhou: "Falha ao gerar o link",
};

const STATUS_TABS: { v: Status; label: string }[] = [
  { v: "novo", label: "Novos" },
  { v: "confirmado", label: "Confirmados" },
  { v: "entregue", label: "Entregues" },
  { v: "cancelado", label: "Cancelados" },
];

const PAYMENT_OPTIONS = [
  { v: "pix", label: "PIX" },
  { v: "dinheiro", label: "Dinheiro" },
  { v: "debito", label: "Cartão de débito" },
  { v: "credito", label: "Cartão de crédito" },
];

const itemLabel = (i: OrderItem) => [i.size, i.color].filter(Boolean).join(" / ");

const formatAddress = (a: Record<string, string> | null) =>
  a
    ? [
        [a.street, a.number].filter(Boolean).join(", "),
        a.complement,
        a.neighborhood,
        [a.city, a.state].filter(Boolean).join("/"),
        a.cep ? `CEP ${a.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : "",
      ].filter(Boolean).join(" · ")
    : "";

/**
 * Pedidos feitos na loja virtual. Confirmar transforma o pedido em venda (entra
 * no Painel, em Vendas e nos relatórios); cancelar devolve as peças reservadas.
 * As duas coisas acontecem no banco (store_update_order), junto com a troca de
 * situação — a tela só pede.
 */
export default function StoreOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Status>("novo");
  const [open, setOpen] = useState<Order | null>(null);
  const [payment, setPayment] = useState("pix");
  const [acting, setActing] = useState(false);
  const [charges, setCharges] = useState<Record<string, Charge>>({});
  const [charging, setCharging] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("store_orders")
      .select(
        "id, code, status, customer_name, customer_phone, customer_email, delivery_method, address, notes, total, created_at, sale_id, store_order_items(id, product_name, size, color, quantity, unit_price)",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) toast.error("Falha ao carregar os pedidos: " + error.message);
    else setOrders((data ?? []) as unknown as Order[]);

    const { data: cobrancas } = await supabase
      .from("payment_charges")
      .select("id, order_id, status, link_url, link_expires_at, paid_at, paid_cents, last_error")
      .order("created_at", { ascending: false })
      .limit(300);
    if (cobrancas) {
      setCharges(Object.fromEntries((cobrancas as Charge[]).map((c) => [c.order_id, c])));
    }
    setLoading(false);
  }, []);

  // Não há aviso em tempo real: recarrega a cada minuto e ao voltar para a aba.
  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { novo: 0, confirmado: 0, entregue: 0, cancelado: 0 };
    for (const o of orders) c[o.status] += 1;
    return c;
  }, [orders]);

  const list = orders.filter((o) => o.status === tab);

  const charge = open ? charges[open.id] : undefined;

  /**
   * Gera (ou reaproveita) o link na InfinitePay e manda para a cliente. Quem
   * fala com a InfinitePay é a função do servidor: a chave nunca passa por aqui.
   */
  const gerarLink = async (enviar: boolean) => {
    if (!open) return;
    setCharging(true);
    const { data, error } = await supabase.functions.invoke("infinitepay-create-link", {
      body: { order_id: open.id, enviar_whatsapp: enviar },
    });
    setCharging(false);
    if (error) {
      toast.error("Não foi possível gerar o link. " + (error.message ?? ""));
      return;
    }
    const r = data as { link?: string; whatsapp?: boolean; ja_pago?: boolean };
    if (r?.ja_pago) toast.info("Este pedido já está pago.");
    else if (enviar) toast.success(r?.whatsapp ? "Link enviado no WhatsApp" : "Link gerado (o WhatsApp falhou)");
    else toast.success("Link gerado");
    load();
  };

  const copiarLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
    } catch {
      toast.error("Não consegui copiar — o link está na tela para você selecionar.");
    }
  };

  const act = async (status: Status) => {
    if (!open) return;
    if (status === "cancelado" && !window.confirm(`Cancelar o pedido #${open.code}? As peças voltam para o estoque.`)) return;
    setActing(true);
    const { error } = await supabase.rpc("store_update_order", {
      p_order_id: open.id,
      p_status: status,
      p_payment_method: payment,
    });
    setActing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      status === "confirmado"
        ? "Pedido confirmado e registrado em Vendas"
        : status === "cancelado"
        ? "Pedido cancelado — peças devolvidas ao estoque"
        : "Pedido marcado como entregue",
    );
    setOpen(null);
    load();
  };

  const whatsappLink = (o: Order) => {
    const first = o.customer_name.split(" ")[0];
    const items = o.store_order_items
      .map((i) => `• ${i.quantity}x ${i.product_name}${itemLabel(i) ? ` (${itemLabel(i)})` : ""}`)
      .join("\n");
    const text = [
      `Olá, ${first}! Aqui é da JMK Modas.`,
      `Recebemos seu pedido #${o.code} na loja virtual:`,
      items,
      `Total das peças: ${fmtBRL(Number(o.total))}`,
      o.delivery_method === "entrega"
        ? "Vamos combinar o frete e a forma de pagamento?"
        : "Vamos combinar a retirada e a forma de pagamento?",
    ].join("\n");
    return `https://wa.me/${o.customer_phone}?text=${encodeURIComponent(text)}`;
  };

  return (
    <div>
      <PageHeader
        title="Pedidos da Loja"
        description="Pedidos feitos pela loja virtual, com as peças já reservadas no estoque"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(); }} className="rounded-xl">
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
            <Button asChild size="sm" className="rounded-xl bg-gradient-primary text-primary-foreground">
              <a href="/loja" target="_blank" rel="noreferrer">
                <Store className="h-4 w-4 mr-1" /> Abrir loja <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Status)} className="mb-4">
        <TabsList className="flex-wrap h-auto">
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.v} value={t.v}>
              {t.label}
              {counts[t.v] > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                  {counts[t.v]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : list.length === 0 ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">
          Nenhum pedido {STATUS_TABS.find((t) => t.v === tab)?.label.toLowerCase()}.
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {list.map((o) => {
            const units = o.store_order_items.reduce((n, i) => n + i.quantity, 0);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => { setOpen(o); setPayment("pix"); }}
                className="glass-card w-full p-4 text-left transition glow-on-hover"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="rounded-lg bg-primary/10 px-2 py-1 font-mono text-xs font-bold text-primary">#{o.code}</span>
                  <span className="font-semibold">{o.customer_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(o.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </span>
                  <span className="ml-auto font-display font-bold">{fmtBRL(Number(o.total))}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{units} peça(s)</span>
                  <span className="inline-flex items-center gap-1">
                    {o.delivery_method === "entrega" ? <Truck className="h-3.5 w-3.5" /> : <Store className="h-3.5 w-3.5" />}
                    {o.delivery_method === "entrega" ? "Entrega" : "Retirada na loja"}
                  </span>
                  <span className="truncate">{o.store_order_items.map((i) => i.product_name).join(", ")}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <StoreSettingsCard />

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="glass-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>Pedido #{open.code}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="rounded-xl bg-white/40 dark:bg-white/5 p-3 space-y-1">
                  <div className="font-semibold">{open.customer_name}</div>
                  <div className="text-muted-foreground">+{open.customer_phone}{open.customer_email ? ` · ${open.customer_email}` : ""}</div>
                  <div className="text-muted-foreground">
                    {format(new Date(open.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </div>
                </div>

                <ul className="divide-y divide-border rounded-xl border border-border">
                  {open.store_order_items.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{i.product_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {i.quantity}x {fmtBRL(Number(i.unit_price))}{itemLabel(i) ? ` · ${itemLabel(i)}` : ""}
                        </div>
                      </div>
                      <span className="font-semibold whitespace-nowrap">{fmtBRL(Number(i.unit_price) * i.quantity)}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between p-3 font-bold">
                    <span>Total das peças</span>
                    <span>{fmtBRL(Number(open.total))}</span>
                  </li>
                </ul>

                <div>
                  <div className="font-medium flex items-center gap-1.5">
                    {open.delivery_method === "entrega" ? <Truck className="h-4 w-4" /> : <Store className="h-4 w-4" />}
                    {open.delivery_method === "entrega" ? "Entrega" : "Retirada na loja"}
                  </div>
                  {open.delivery_method === "entrega" && (
                    <p className="mt-1 text-muted-foreground">{formatAddress(open.address)}</p>
                  )}
                </div>

                {open.notes && (
                  <div>
                    <div className="font-medium">Observações</div>
                    <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{open.notes}</p>
                  </div>
                )}

                <div className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium flex items-center gap-1.5">
                      <CreditCard className="h-4 w-4" /> Pagamento online
                    </span>
                    <span className={`text-xs font-semibold ${charge?.status === "pago" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                      {charge ? CHARGE_LABEL[charge.status] ?? charge.status : "Link não gerado"}
                    </span>
                  </div>

                  {charge?.status === "pago" ? (
                    <p className="text-xs text-muted-foreground">
                      Pago {charge.paid_cents ? fmtBRL(charge.paid_cents / 100) : ""}
                      {charge.paid_at ? ` em ${format(new Date(charge.paid_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}` : ""}
                      {" "}— confirmado pela InfinitePay.
                    </p>
                  ) : (
                    <>
                      {charge?.link_url && (
                        <p className="break-all text-xs text-muted-foreground">{charge.link_url}</p>
                      )}
                      {charge?.last_error && (
                        <p className="text-xs text-destructive">{charge.last_error}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="rounded-xl" disabled={charging}
                                onClick={() => gerarLink(true)}>
                          {charging ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />}
                          {charge?.link_url ? "Reenviar no WhatsApp" : "Gerar link e enviar"}
                        </Button>
                        {charge?.link_url && (
                          <Button size="sm" variant="outline" className="rounded-xl"
                                  onClick={() => copiarLink(charge.link_url!)}>
                            <Copy className="h-4 w-4 mr-1" /> Copiar link
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <Button asChild variant="outline" className="w-full rounded-xl">
                  <a href={whatsappLink(open)} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-4 w-4 mr-1" /> Chamar no WhatsApp
                  </a>
                </Button>

                {open.status === "novo" && (
                  <div className="rounded-xl border border-border p-3 space-y-2">
                    <Label>Forma de pagamento recebida</Label>
                    <Select value={payment} onValueChange={setPayment}>
                      <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAYMENT_OPTIONS.map((p) => (
                          <SelectItem key={p.v} value={p.v}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Ao confirmar, o pedido vira uma venda e o cliente é vinculado pelo telefone (ou cadastrado).
                    </p>
                  </div>
                )}
                {open.status === "confirmado" && (
                  <p className="text-xs text-muted-foreground">
                    Este pedido já está em Vendas. Para desfazer, exclua a venda lá — ela devolve as peças ao estoque.
                  </p>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                {open.status === "novo" && (
                  <>
                    <Button variant="outline" onClick={() => act("cancelado")} disabled={acting} className="rounded-xl">
                      <XCircle className="h-4 w-4 mr-1" /> Cancelar pedido
                    </Button>
                    <Button onClick={() => act("confirmado")} disabled={acting} className="rounded-xl bg-gradient-primary text-primary-foreground">
                      {acting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                      Confirmar pedido
                    </Button>
                  </>
                )}
                {open.status === "confirmado" && (
                  <Button onClick={() => act("entregue")} disabled={acting} className="rounded-xl bg-gradient-primary text-primary-foreground">
                    {acting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PackageCheck className="h-4 w-4 mr-1" />}
                    Marcar como entregue
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** O que a loja mostra para o público: WhatsApp de contato, endereço de retirada e aviso de entrega. */
function StoreSettingsCard() {
  const [form, setForm] = useState({
    whatsapp: "", pickup_address: "", delivery_note: "",
    order_alert_whatsapp: "", order_confirm_customer: true,
    payment_link_enabled: false, payment_link_hours: 72,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("store_settings")
      .select("whatsapp, pickup_address, delivery_note, order_alert_whatsapp, order_confirm_customer, payment_link_enabled, payment_link_hours")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setForm({
            whatsapp: data.whatsapp ?? "",
            pickup_address: data.pickup_address ?? "",
            delivery_note: data.delivery_note ?? "",
            order_alert_whatsapp: data.order_alert_whatsapp ?? "",
            order_confirm_customer: data.order_confirm_customer ?? true,
            payment_link_enabled: data.payment_link_enabled ?? false,
            payment_link_hours: data.payment_link_hours ?? 72,
          });
        }
        setLoaded(true);
      });
  }, []);

  const save = async () => {
    const digits = form.whatsapp.replace(/\D/g, "");
    const whatsapp = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
    if (whatsapp && (whatsapp.length < 12 || whatsapp.length > 13)) {
      toast.error("WhatsApp inválido: use DDD + número");
      return;
    }
    // Grupo entra pelo JID inteiro (termina em @g.us); número vira DDI + DDD.
    const alertRaw = form.order_alert_whatsapp.trim();
    const alertDigits = alertRaw.replace(/\D/g, "");
    const alerta = alertRaw.endsWith("@g.us")
      ? alertRaw
      : alertDigits.length === 10 || alertDigits.length === 11
        ? `55${alertDigits}`
        : alertDigits;
    if (alerta && !alerta.endsWith("@g.us") && (alerta.length < 12 || alerta.length > 13)) {
      toast.error("Número do aviso inválido: use DDD + número");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("store_settings")
      .update({
        whatsapp: whatsapp || null,
        pickup_address: form.pickup_address.trim() || null,
        delivery_note: form.delivery_note.trim() || null,
        order_alert_whatsapp: alerta || null,
        order_confirm_customer: form.order_confirm_customer,
        payment_link_enabled: form.payment_link_enabled,
        payment_link_hours: Math.min(720, Math.max(1, Number(form.payment_link_hours) || 72)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      setForm((f) => ({ ...f, whatsapp, order_alert_whatsapp: alerta }));
      toast.success("Configurações da loja salvas");
    }
  };

  return (
    <GlassCard className="mt-8 p-5">
      <h3 className="font-semibold">Informações exibidas na loja</h3>
      <p className="text-xs text-muted-foreground mt-1">Aparecem para qualquer visitante da loja virtual.</p>
      {!loaded ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary mt-4" />
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <Label>WhatsApp da loja</Label>
            <Input
              value={form.whatsapp}
              onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
              placeholder="(11) 98765-4321"
              className="glass-input mt-1"
            />
          </div>
          <div>
            <Label>Endereço para retirada</Label>
            <Input
              value={form.pickup_address}
              onChange={(e) => setForm((f) => ({ ...f, pickup_address: e.target.value }))}
              placeholder="Rua, número — bairro, cidade"
              className="glass-input mt-1"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Aviso sobre entrega</Label>
            <Textarea
              value={form.delivery_note}
              onChange={(e) => setForm((f) => ({ ...f, delivery_note: e.target.value }))}
              placeholder="Ex.: entregamos em Osasco e região; frete combinado pelo WhatsApp"
              className="glass-input mt-1"
              rows={2}
            />
          </div>
          <div className="md:col-span-2 border-t pt-4">
            <h4 className="font-medium text-sm">Aviso de pedido novo</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Quando a cliente fecha a sacola, o pedido chega no WhatsApp. Em branco, vai para o WhatsApp da loja
              acima; pode ser outro número da equipe ou um grupo (cole o JID terminado em @g.us).
            </p>
          </div>
          <div>
            <Label>Mandar o aviso para</Label>
            <Input
              value={form.order_alert_whatsapp}
              onChange={(e) => setForm((f) => ({ ...f, order_alert_whatsapp: e.target.value }))}
              placeholder="WhatsApp da loja"
              className="glass-input mt-1"
            />
          </div>
          <div className="flex items-start gap-3 pt-7">
            <Switch
              id="confirm-cliente"
              checked={form.order_confirm_customer}
              onCheckedChange={(v) => setForm((f) => ({ ...f, order_confirm_customer: v }))}
            />
            <Label htmlFor="confirm-cliente" className="leading-snug">
              Confirmar o pedido para a cliente
              <span className="block text-xs font-normal text-muted-foreground">
                Ela recebe o código, as peças e o total assim que o pedido entra.
              </span>
            </Label>
          </div>

          <div className="md:col-span-2 border-t pt-4">
            <h4 className="font-medium text-sm">Pagamento online (InfinitePay)</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Com isto ligado, cada pedido novo recebe um link de Pix ou cartão junto com a confirmação no
              WhatsApp, e a baixa acontece sozinha quando a cliente paga. Precisa das chaves da InfinitePay
              cadastradas — sem elas, deixe desligado.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="pagamento-online"
              checked={form.payment_link_enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, payment_link_enabled: v }))}
            />
            <Label htmlFor="pagamento-online" className="leading-snug">
              Mandar link de pagamento
              <span className="block text-xs font-normal text-muted-foreground">
                Desligado, o pedido segue combinado pelo WhatsApp, como sempre foi.
              </span>
            </Label>
          </div>
          <div>
            <Label htmlFor="validade-link">O link vale por (horas)</Label>
            <Input
              id="validade-link"
              type="number"
              min={1}
              max={720}
              value={form.payment_link_hours}
              onChange={(e) => setForm((f) => ({ ...f, payment_link_hours: Number(e.target.value) }))}
              className="glass-input mt-1"
            />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <Button onClick={save} disabled={saving} className="rounded-xl bg-gradient-primary text-primary-foreground">
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar
            </Button>
          </div>
        </div>
      )}
    </GlassCard>
  );
}
