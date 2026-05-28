import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Search, Layers, AlertTriangle, FileUp, Loader2, Image as ImageIcon, Upload, X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import SupplierImageSearch from "@/components/SupplierImageSearch";
import { usePagination } from "@/hooks/usePagination";

interface Variant { id?: string; size: string; color: string; quantity: number; image_url?: string | null; }
interface Product {
  id: string; name: string; description: string | null; category: string | null;
  sku: string | null; supplier: string | null;
  price: number; cost: number; low_stock_threshold: number; active: boolean;
  image_url?: string | null;
  product_variants?: Variant[];
}

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  sku: z.string().trim().max(60).optional().or(z.literal("")),
  supplier: z.string().trim().max(120).optional().or(z.literal("")),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  price: z.number().nonnegative(),
  cost: z.number().nonnegative(),
  low_stock_threshold: z.number().int().nonnegative(),
});

export default function Inventory() {
  const [list, setList] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [imgSearchOpen, setImgSearchOpen] = useState(false);
  const [imgSearchTarget, setImgSearchTarget] = useState<{
    productName: string;
    supplier?: string | null;
    variantId?: string;
    productId?: string;
    applyToAllVariants?: boolean;
    onLocal?: (url: string) => void;
  } | null>(null);

  const openImgSearchForVariant = (i: number) => {
    const name = (document.querySelector('input[name="name"]') as HTMLInputElement | null)?.value || editing?.name || "";
    const sup = (document.querySelector('input[name="supplier"]') as HTMLInputElement | null)?.value || editing?.supplier || "";
    if (!name) { toast.error("Preencha o nome do produto primeiro"); return; }
    setImgSearchTarget({
      productName: name,
      supplier: sup,
      variantId: variants[i]?.id,
      onLocal: (url) => updVariant(i, { image_url: url }),
    });
    setImgSearchOpen(true);
  };

  const openImgSearchForProduct = (p: Product) => {
    setImgSearchTarget({
      productName: p.name,
      supplier: p.supplier,
      productId: p.id,
      applyToAllVariants: true,
    });
    setImgSearchOpen(true);
  };

  const handleImport = async () => {
    if (!importFile) { toast.error("Selecione um PDF"); return; }
    if (importFile.type !== "application/pdf") { toast.error("Apenas PDF é suportado"); return; }
    setImporting(true);
    try {
      const path = `${Date.now()}_${importFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("romaneios").upload(path, importFile);
      if (upErr) throw upErr;
      const { data, error } = await supabase.functions.invoke("parse-romaneio", {
        body: { storage_path: path },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(
        `Romaneio importado: ${data.products_created} produtos novos, ${data.variants_added} variações adicionadas, ${data.payable_created} conta(s) a pagar criada(s)`
      );
      setImportOpen(false);
      setImportFile(null);
      load();
    } catch (e: any) {
      toast.error("Falha na importação: " + (e?.message || "erro desconhecido"));
    } finally {
      setImporting(false);
    }
  };

  const load = async () => {
    const { data, error } = await supabase
      .from("products")
      .select("*, product_variants(*)")
      .order("name");
    if (error) toast.error(error.message);
    else setList((data ?? []) as Product[]);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setVariants([]); setOpen(true); };
  const openEdit = (p: Product) => {
    setEditing(p);
    setVariants(p.product_variants?.map((v) => ({ id: v.id, size: v.size, color: v.color, quantity: v.quantity, image_url: v.image_url ?? null })) ?? []);
    setOpen(true);
  };

  const uploadVariantImage = async (i: number, file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem muito grande (máx 5MB)"); return; }
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await supabase.storage.from("product-images").upload(path, file, { upsert: false });
    if (upErr) { toast.error("Falha no upload: " + upErr.message); return; }
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    updVariant(i, { image_url: data.publicUrl });
    toast.success("Foto adicionada");
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = schema.safeParse({
      name: f.get("name"),
      sku: f.get("sku"),
      supplier: f.get("supplier"),
      category: f.get("category"),
      description: f.get("description"),
      price: Number(f.get("price")),
      cost: Number(f.get("cost")),
      low_stock_threshold: Number(f.get("low_stock_threshold") || 5),
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    const payload = {
      name: parsed.data.name,
      sku: parsed.data.sku || null,
      supplier: parsed.data.supplier || null,
      description: parsed.data.description || null,
      category: parsed.data.category || null,
      price: parsed.data.price,
      cost: parsed.data.cost,
      low_stock_threshold: parsed.data.low_stock_threshold,
    };

    let productId = editing?.id;
    if (editing) {
      const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from("products").insert(payload).select().single();
      if (error || !data) { toast.error(error?.message || "Erro"); return; }
      productId = data.id;
    }

    // Sync variants
    if (productId) {
      await supabase.from("product_variants").delete().eq("product_id", productId);
      if (variants.length > 0) {
        const toInsert = variants
          .filter((v) => v.size || v.color)
          .map((v) => ({
            product_id: productId,
            size: v.size || null,
            color: v.color || null,
            quantity: Number(v.quantity) || 0,
            image_url: v.image_url || null,
          }));
        if (toInsert.length > 0) {
          const { error: ve } = await supabase.from("product_variants").insert(toInsert);
          if (ve) toast.error("Erro nas variações: " + ve.message);
        }
      }
    }

    toast.success(editing ? "Produto atualizado" : "Produto cadastrado");
    setOpen(false); setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir produto e suas variações?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Excluído"); load(); }
  };

  const addVariant = () => setVariants((v) => [...v, { size: "", color: "", quantity: 0 }]);
  const updVariant = (i: number, patch: Partial<Variant>) =>
    setVariants((v) => v.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const delVariant = (i: number) => setVariants((v) => v.filter((_, idx) => idx !== i));

  const totalQty = (p: Product) => p.product_variants?.reduce((s, v) => s + v.quantity, 0) ?? 0;
  const isLow = (p: Product) => totalQty(p) <= p.low_stock_threshold;

  const suppliers = Array.from(new Set(list.map((p) => p.supplier).filter((s): s is string => !!s && s.trim() !== ""))).sort();

  const filtered = list.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch =
      p.name.toLowerCase().includes(q) ||
      (p.category ?? "").toLowerCase().includes(q) ||
      (p.supplier ?? "").toLowerCase().includes(q);
    const matchesSupplier = supplierFilter === "all" || p.supplier === supplierFilter;
    return matchesSearch && matchesSupplier;
  });
  const { paged, Controls } = usePagination(filtered, 20);

  const stockTotals = filtered.reduce(
    (acc, p) => {
      const qty = totalQty(p);
      acc.units += qty;
      acc.cost += qty * Number(p.cost ?? 0);
      acc.potential += qty * Number(p.price ?? 0);
      return acc;
    },
    { units: 0, cost: 0, potential: 0 }
  );
  const fmtBRL = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const margin = stockTotals.potential - stockTotals.cost;

  return (
    <div>
      <PageHeader
        title="Estoque"
        description={`${list.length} produtos`}
        actions={
          <>
            <Button onClick={() => setImportOpen(true)} variant="outline" className="rounded-xl">
              <FileUp className="h-4 w-4 mr-1" /> Importar romaneio
            </Button>
            <Button onClick={openNew} className="bg-gradient-primary text-primary-foreground shadow-glow rounded-xl">
              <Plus className="h-4 w-4 mr-1" /> Novo produto
            </Button>
          </>
        }
      />

      <GlassCard>
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto, categoria ou fornecedor..." className="glass-input pl-10" />
          </div>
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="glass-input h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-56"
          >
            <option value="all">Todos os fornecedores</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="p-3 rounded-2xl bg-white/40 backdrop-blur">
            <div className="text-[11px] text-muted-foreground">Peças em estoque</div>
            <div className="text-lg font-semibold mt-0.5">{stockTotals.units}</div>
          </div>
          <div className="p-3 rounded-2xl bg-white/40 backdrop-blur">
            <div className="text-[11px] text-muted-foreground">Investido (custo)</div>
            <div className="text-lg font-semibold mt-0.5">{fmtBRL(stockTotals.cost)}</div>
          </div>
          <div className="p-3 rounded-2xl bg-white/40 backdrop-blur">
            <div className="text-[11px] text-muted-foreground">Potencial de venda</div>
            <div className="text-lg font-semibold mt-0.5 text-primary">{fmtBRL(stockTotals.potential)}</div>
          </div>
          <div className="p-3 rounded-2xl bg-white/40 backdrop-blur">
            <div className="text-[11px] text-muted-foreground">Lucro potencial</div>
            <div className="text-lg font-semibold mt-0.5 text-success">{fmtBRL(margin)}</div>
          </div>
        </div>

        <div className="grid gap-3">
          {paged.map((p) => (
            <div key={p.id} className="p-4 rounded-2xl bg-white/40 backdrop-blur hover:bg-white/60 transition-all">
              <div className="flex items-start gap-3">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-16 w-16 rounded-xl object-cover border border-white/40 shrink-0" />
                ) : (
                  <div className="h-16 w-16 rounded-xl border border-dashed border-muted-foreground/40 bg-white/20 flex items-center justify-center shrink-0">
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{p.name}</span>
                    {p.sku && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">SKU: {p.sku}</span>}
                    {p.category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{p.category}</span>}
                    {p.supplier && <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/30 text-accent-foreground">{p.supplier}</span>}
                    {isLow(p) && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/20 text-warning-foreground inline-flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Estoque baixo
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    R$ {Number(p.price).toFixed(2)} • {totalQty(p)} em estoque
                  </div>
                  {p.product_variants && p.product_variants.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.product_variants.map((v, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary inline-flex items-center gap-1">
                          <Layers className="h-2.5 w-2.5" />
                          {[v.size, v.color].filter(Boolean).join(" / ")}: {v.quantity}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openImgSearchForProduct(p)} title="Buscar imagem do fornecedor" className="text-xs">
                    <Sparkles className="h-3.5 w-3.5 mr-1" /> Foto
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(p)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(p.id)} aria-label="Excluir"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">Nenhum produto</div>}
        </div>
        <Controls />
      </GlassCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-card border-white/40 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} produto</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome</Label><Input name="name" defaultValue={editing?.name} required className="glass-input" /></div>
              <div><Label>SKU</Label><Input name="sku" defaultValue={editing?.sku ?? ""} placeholder="VST-001" className="glass-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Categoria</Label><Input name="category" defaultValue={editing?.category ?? ""} placeholder="Vestido, Blusa..." className="glass-input" /></div>
              <div><Label>Fornecedor</Label><Input name="supplier" defaultValue={editing?.supplier ?? ""} placeholder="Nome do fornecedor" className="glass-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Estoque mínimo</Label><Input name="low_stock_threshold" type="number" defaultValue={editing?.low_stock_threshold ?? 5} min={0} className="glass-input" /></div>
              <div></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Preço (R$)</Label><Input name="price" type="number" step="0.01" defaultValue={editing?.price ?? 0} required className="glass-input" /></div>
              <div><Label>Custo (R$)</Label><Input name="cost" type="number" step="0.01" defaultValue={editing?.cost ?? 0} className="glass-input" /></div>
            </div>
            <div><Label>Descrição</Label><Textarea name="description" defaultValue={editing?.description ?? ""} className="glass-input" rows={2} /></div>

            <div className="border-t border-white/30 pt-3">
              <div className="flex items-center justify-between mb-2">
                <Label>Variações (tamanho/cor/qtd)</Label>
                <Button type="button" size="sm" variant="ghost" onClick={addVariant}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
              </div>
              <div className="space-y-3">
                {variants.map((v, i) => (
                  <div key={i} className="p-3 rounded-xl bg-white/30 dark:bg-white/5 space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_80px_auto] gap-2">
                      <Input placeholder="P/M/G" value={v.size} onChange={(e) => updVariant(i, { size: e.target.value })} className="glass-input" />
                      <Input placeholder="Cor" value={v.color} onChange={(e) => updVariant(i, { color: e.target.value })} className="glass-input" />
                      <Input type="number" value={v.quantity} onChange={(e) => updVariant(i, { quantity: Number(e.target.value) })} className="glass-input" />
                      <Button type="button" size="icon" variant="ghost" onClick={() => delVariant(i)} aria-label="Excluir variante"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    <div className="flex items-center gap-2">
                      {v.image_url ? (
                        <div className="relative h-16 w-16 rounded-lg overflow-hidden border border-white/40">
                          <img src={v.image_url} alt={`${v.color || "variação"}`} className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => updVariant(i, { image_url: null })}
                            className="absolute top-0 right-0 bg-destructive/90 text-destructive-foreground rounded-bl-md p-0.5"
                            aria-label="Remover foto"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="h-16 w-16 rounded-lg border border-dashed border-muted-foreground/40 flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                      <label className="cursor-pointer text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition">
                        <Upload className="h-3 w-3" />
                        {v.image_url ? "Trocar foto" : "Adicionar foto"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadVariantImage(i, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => openImgSearchForVariant(i)}
                        className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition"
                        title="Buscar imagem no site do fornecedor"
                      >
                        <Sparkles className="h-3 w-3" /> Buscar do fornecedor
                      </button>
                    </div>
                  </div>
                ))}
                {variants.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma variação ainda.</p>}
              </div>
            </div>

            <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground rounded-xl">Salvar</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(o) => { if (!importing) { setImportOpen(o); if (!o) setImportFile(null); } }}>
        <DialogContent className="glass-card border-white/40 max-w-md">
          <DialogHeader><DialogTitle>Importar romaneio (PDF)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Anexe o PDF do romaneio. A IA extrai fornecedor, produtos e parcelas para cadastrar
              automaticamente no estoque (margem 100% arredondada para cima) e em contas a pagar.
            </p>
            <div>
              <Label>Arquivo PDF</Label>
              <Input
                type="file"
                accept="application/pdf"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                disabled={importing}
                className="glass-input mt-1"
              />
              {importFile && <p className="text-xs text-muted-foreground mt-1">{importFile.name}</p>}
            </div>
            <Button
              onClick={handleImport}
              disabled={!importFile || importing}
              className="w-full bg-gradient-primary text-primary-foreground rounded-xl"
            >
              {importing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processando...</>) : (<><FileUp className="h-4 w-4 mr-2" /> Importar</>)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {imgSearchTarget && (
        <SupplierImageSearch
          open={imgSearchOpen}
          onOpenChange={(o) => { setImgSearchOpen(o); if (!o) setImgSearchTarget(null); }}
          productName={imgSearchTarget.productName}
          supplier={imgSearchTarget.supplier}
          variantId={imgSearchTarget.variantId}
          productId={imgSearchTarget.productId}
          applyToAllVariants={imgSearchTarget.applyToAllVariants}
          onSaved={(url) => {
            imgSearchTarget.onLocal?.(url);
            load();
          }}
        />
      )}
    </div>
  );
}
