import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { LabelScanner, ScannedLabel } from "@/components/LabelScanner";
import { Trash2, Plus, Search, Loader2, UserPlus, ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface Customer { id: string; name: string; phone: string | null; tax_id: string | null; }

interface Item {
  tempId: string;
  product_id: string | null;
  variant_id: string | null;
  supplier: string | null;
  code: string | null;
  description: string;
  color: string | null;
  size: string | null;
  quantity: number;
  unit_price: number;
  photo_url: string | null;
  raw_ocr: any;
  is_draft_product: boolean; // se vai criar produto rascunho ao salvar
  existing_image: string | null;
}

const newId = () => Math.random().toString(36).slice(2);

export default function PreSaleForm() {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = !!editId;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);

  // novo cliente rápido
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncPhone, setNcPhone] = useState("");
  const [ncTaxId, setNcTaxId] = useState("");

  // edição de item após scan
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingMatchOpts, setEditingMatchOpts] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("customers").select("id,name,phone,tax_id").order("name").limit(500)
      .then(({ data }) => setCustomers((data as any) ?? []));
  }, []);

  // autosave rascunho (apenas para nova)
  useEffect(() => {
    if (isEdit) return;
    const draft = { customer, items, notes };
    localStorage.setItem("presale_draft", JSON.stringify(draft));
  }, [customer, items, notes, isEdit]);

  useEffect(() => {
    if (isEdit) return;
    const raw = localStorage.getItem("presale_draft");
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d.customer) setCustomer(d.customer);
        if (d.items) setItems(d.items);
        if (d.notes) setNotes(d.notes);
      } catch {}
    }
  }, [isEdit]);

  // carrega pré-venda para edição
  useEffect(() => {
    if (!isEdit || !editId) return;
    (async () => {
      const [{ data: ps }, { data: it }] = await Promise.all([
        supabase.from("pre_sales").select("*,customer:customers(id,name,phone,tax_id)").eq("id", editId).maybeSingle(),
        supabase.from("pre_sale_items").select("*").eq("pre_sale_id", editId).order("created_at"),
      ]);
      if (ps) {
        setCustomer((ps as any).customer ?? null);
        setNotes((ps as any).notes ?? "");
      }
      setItems(((it as any[]) ?? []).map(i => ({
        tempId: i.id,
        product_id: i.product_id,
        variant_id: i.variant_id,
        supplier: i.supplier,
        code: i.code,
        description: i.description,
        color: i.color,
        size: i.size,
        quantity: i.quantity,
        unit_price: Number(i.unit_price),
        photo_url: i.photo_url,
        raw_ocr: i.raw_ocr,
        is_draft_product: false,
        existing_image: null,
      })));
      setLoadingEdit(false);
    })();
  }, [isEdit, editId]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 8);
    const q = customerSearch.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.tax_id?.includes(q)
    ).slice(0, 8);
  }, [customers, customerSearch]);

  const total = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const onScanned = async (data: ScannedLabel, photoDataUrl: string) => {
    // tenta achar produto existente por código/SKU/descrição
    let match: any[] = [];
    const code = data.code ?? data.barcode ?? data.reference;
    if (code) {
      const { data: byCode } = await supabase.from("products")
        .select("id,name,price,image_url,sku,supplier,product_variants(id,size,color,quantity,image_url)")
        .or(`sku.ilike.%${code}%`).limit(5);
      match = (byCode as any) ?? [];
    }
    if (match.length === 0 && data.description) {
      const term = data.description.split(" ").slice(0, 3).join(" ");
      const { data: byName } = await supabase.from("products")
        .select("id,name,price,image_url,sku,supplier,product_variants(id,size,color,quantity,image_url)")
        .ilike("name", `%${term}%`).limit(5);
      match = (byName as any) ?? [];
    }

    const matched = match[0];
    let variant: any = null;
    if (matched && (data.size || data.color)) {
      variant = matched.product_variants?.find((v: any) =>
        (!data.size || v.size?.toLowerCase() === data.size?.toLowerCase()) &&
        (!data.color || v.color?.toLowerCase() === data.color?.toLowerCase())
      );
    }

    const item: Item = {
      tempId: newId(),
      product_id: matched?.id ?? null,
      variant_id: variant?.id ?? null,
      supplier: data.supplier ?? matched?.supplier ?? null,
      code: code ?? matched?.sku ?? null,
      description: matched?.name ?? data.description ?? "Sem descrição",
      color: data.color ?? variant?.color ?? null,
      size: data.size ?? variant?.size ?? null,
      quantity: 1,
      unit_price: Number(matched?.price ?? data.suggested_price ?? 0),
      photo_url: photoDataUrl,
      raw_ocr: data,
      is_draft_product: !matched,
      existing_image: matched?.image_url ?? null,
    };
    setEditing(item);
    setEditingMatchOpts(match);
  };

  const confirmItem = () => {
    if (!editing) return;
    if (!editing.description.trim()) return toast.error("Descrição obrigatória");
    setItems(prev => [...prev, editing]);
    setEditing(null);
    toast.success("Item adicionado");
  };

  const removeItem = (tempId: string) =>
    setItems(prev => prev.filter(i => i.tempId !== tempId));

  const updateItem = (tempId: string, patch: Partial<Item>) =>
    setItems(prev => prev.map(i => i.tempId === tempId ? { ...i, ...patch } : i));

  const createCustomer = async () => {
    if (!ncName.trim()) return toast.error("Nome obrigatório");
    const { data, error } = await supabase.from("customers")
      .insert({ name: ncName, phone: ncPhone || null, tax_id: ncTaxId || null })
      .select().single();
    if (error) return toast.error(error.message);
    setCustomer(data as any);
    setCustomers(prev => [data as any, ...prev]);
    setNewCustomerOpen(false);
    setNcName(""); setNcPhone(""); setNcTaxId("");
  };

  const save = async () => {
    if (items.length === 0) return toast.error("Adicione ao menos 1 item");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // 1. cria pre_sale
      const { data: ps, error: psErr } = await supabase.from("pre_sales").insert({
        customer_id: customer?.id ?? null,
        seller_id: user?.id ?? null,
        total,
        notes: notes || null,
      }).select().single();
      if (psErr) throw psErr;

      // 2. para cada item: se é rascunho, cria produto+variante
      const itemsPayload = [];
      for (const it of items) {
        let productId = it.product_id;
        let variantId = it.variant_id;
        if (!productId && it.is_draft_product) {
          const { data: prod, error: pe } = await supabase.from("products").insert({
            name: it.description,
            supplier: it.supplier,
            sku: it.code,
            price: it.unit_price,
            cost: 0,
            is_draft: true,
            active: true,
            low_stock_threshold: 0,
          }).select().single();
          if (pe) throw pe;
          productId = prod.id;
          if (it.size || it.color) {
            const { data: vr } = await supabase.from("product_variants").insert({
              product_id: prod.id,
              size: it.size,
              color: it.color,
              quantity: 0,
            }).select().single();
            variantId = vr?.id ?? null;
          }
        }
        itemsPayload.push({
          pre_sale_id: ps.id,
          product_id: productId,
          variant_id: variantId,
          supplier: it.supplier,
          code: it.code,
          description: it.description,
          color: it.color,
          size: it.size,
          quantity: it.quantity,
          unit_price: it.unit_price,
          subtotal: it.unit_price * it.quantity,
          photo_url: it.photo_url,
          raw_ocr: it.raw_ocr,
        });
      }
      const { error: iErr } = await supabase.from("pre_sale_items").insert(itemsPayload);
      if (iErr) throw iErr;

      localStorage.removeItem("presale_draft");
      toast.success("Pré-venda criada!");
      navigate(`/pre-vendas/${ps.id}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto py-6 px-4 max-w-3xl pb-32">
      <PageHeader title="Nova Pré-Venda" description="Escaneie etiquetas, monte o pedido e finalize" />

      {/* Cliente */}
      <GlassCard className="mb-4">
        <Label className="text-xs text-muted-foreground mb-2 block">Cliente</Label>
        {customer ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">{customer.name}</div>
              <div className="text-xs text-muted-foreground">{customer.phone ?? "—"}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>Trocar</Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone, CPF..."
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto space-y-1">
              {filteredCustomers.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCustomer(c)}
                  className="w-full text-left p-2 rounded hover:bg-accent text-sm"
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.phone ?? c.tax_id ?? "—"}</div>
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => setNewCustomerOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" /> Novo cliente
            </Button>
          </>
        )}
      </GlassCard>

      {/* Scanner */}
      <GlassCard className="mb-4">
        <LabelScanner
          onScanned={onScanned}
          className="w-full h-16 text-base bg-gradient-primary text-primary-foreground shadow-glow"
        />
        <p className="text-xs text-muted-foreground text-center mt-2">
          Aponte a câmera para a etiqueta. A IA preenche tudo sozinha.
        </p>
      </GlassCard>

      {/* Itens */}
      <div className="space-y-2 mb-4">
        {items.map(it => (
          <GlassCard key={it.tempId} className="!p-3">
            <div className="flex gap-3">
              {(it.existing_image || it.photo_url) && (
                <img src={it.existing_image || it.photo_url!} alt="" className="h-16 w-16 rounded object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{it.description}</div>
                <div className="text-xs text-muted-foreground">
                  {[it.size, it.color, it.supplier].filter(Boolean).join(" · ")}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={e => updateItem(it.tempId, { quantity: Math.max(1, Number(e.target.value)) })}
                    className="h-8 w-16"
                  />
                  <span className="text-xs">×</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={it.unit_price}
                    onChange={e => updateItem(it.tempId, { unit_price: Number(e.target.value) })}
                    className="h-8 w-24"
                  />
                  <span className="ml-auto font-bold text-sm">
                    R$ {(it.quantity * it.unit_price).toFixed(2)}
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => removeItem(it.tempId)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                {it.is_draft_product && (
                  <div className="text-[10px] text-amber-500 mt-1">📝 Será cadastrado como rascunho</div>
                )}
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Notas */}
      <GlassCard className="mb-4">
        <Label className="text-xs text-muted-foreground mb-2 block">Observações</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
      </GlassCard>

      {/* Footer fixo */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t p-3 z-10">
        <div className="container mx-auto max-w-3xl flex items-center gap-3">
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-2xl font-bold">R$ {total.toFixed(2)}</div>
          </div>
          <Button size="lg" onClick={save} disabled={saving || items.length === 0}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar pré-venda"}
          </Button>
        </div>
      </div>

      {/* Dialog confirmar item */}
      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing?.product_id ? "Item encontrado no estoque" : "Novo item (não cadastrado)"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              {editing.photo_url && (
                <img src={editing.photo_url} alt="" className="w-full h-32 object-cover rounded" />
              )}
              {editingMatchOpts.length > 1 && (
                <div className="text-xs">
                  <div className="text-muted-foreground mb-1">Outras possibilidades:</div>
                  {editingMatchOpts.slice(1, 4).map((m: any) => (
                    <button
                      key={m.id}
                      className="block w-full text-left p-2 hover:bg-accent rounded"
                      onClick={() => setEditing({
                        ...editing,
                        product_id: m.id,
                        description: m.name,
                        unit_price: Number(m.price),
                        existing_image: m.image_url,
                        is_draft_product: false,
                      })}
                    >
                      {m.name} — R$ {Number(m.price).toFixed(2)}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Descrição</Label>
                  <Input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Fornecedor</Label>
                  <Input value={editing.supplier ?? ""} onChange={e => setEditing({ ...editing, supplier: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Cor</Label>
                  <Input value={editing.color ?? ""} onChange={e => setEditing({ ...editing, color: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Tamanho</Label>
                  <Input value={editing.size ?? ""} onChange={e => setEditing({ ...editing, size: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Código</Label>
                  <Input value={editing.code ?? ""} onChange={e => setEditing({ ...editing, code: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Preço (R$) *</Label>
                  <Input type="number" step="0.01" value={editing.unit_price}
                    onChange={e => setEditing({ ...editing, unit_price: Number(e.target.value) })} />
                </div>
              </div>
              {!editing.product_id && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={editing.is_draft_product}
                    onCheckedChange={(c) => setEditing({ ...editing, is_draft_product: !!c })}
                  />
                  Cadastrar no estoque como rascunho
                </label>
              )}
              {typeof editing.raw_ocr?.confidence === "number" && (
                <div className="text-[10px] text-muted-foreground">
                  Confiança da IA: {Math.round(editing.raw_ocr.confidence * 100)}%
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={confirmItem}>
              <Plus className="h-4 w-4 mr-2" /> Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog novo cliente */}
      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Novo cliente</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input placeholder="Nome *" value={ncName} onChange={e => setNcName(e.target.value)} />
            <Input placeholder="Telefone" value={ncPhone} onChange={e => setNcPhone(e.target.value)} />
            <Input placeholder="CPF" value={ncTaxId} onChange={e => setNcTaxId(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCustomerOpen(false)}>Cancelar</Button>
            <Button onClick={createCustomer}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
