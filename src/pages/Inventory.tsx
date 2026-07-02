import { useEffect, useRef, useState } from "react";
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
import { importRomaneioPhotos } from "@/lib/romaneioPhotos";

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
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<Array<{ name: string; status: "pending" | "running" | "ok" | "skip" | "err"; msg?: string; retriable?: boolean }>>([]);
  const cancelImportRef = useRef(false);
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

  const handleImport = async (filesOverride?: File[]) => {
    const source = filesOverride ?? importFiles;
    if (!source.length) { toast.error("Selecione ao menos um PDF"); return; }
    const pdfs = source.filter((f) => f.type === "application/pdf");
    if (!pdfs.length) { toast.error("Apenas PDF é suportado"); return; }

    setImporting(true);
    cancelImportRef.current = false;
    const initial = pdfs.map((f) => ({ name: f.name, status: "pending" as const }));
    setImportProgress(initial);

    const updateItem = (idx: number, patch: Partial<{ status: "pending" | "running" | "ok" | "skip" | "err"; msg: string; retriable: boolean }>) => {
      setImportProgress((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    };

    const photosQueue: File[] = [];
    let imported = 0, skipped = 0, failed = 0;
    let cancelled = false;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const invokeWithRetry = async (path: string, file_hash: string, filename: string) => {
      const delays = [0, 2000, 5000];
      let lastErr: any;
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) await sleep(delays[attempt]);
        try {
          const { data, error } = await supabase.functions.invoke("parse-romaneio", {
            body: { storage_path: path, file_hash, filename },
          });
          if (error) {
            const msg = String(error.message || "");
            const ctx: any = (error as any).context;
            const status: number | undefined = ctx?.status ?? ctx?.response?.status;
            const retriable = status === 429 || (status && status >= 500) || /fetch|network|timeout/i.test(msg);
            if (retriable && attempt < delays.length - 1) { lastErr = error; continue; }
            throw error;
          }
          return data;
        } catch (e: any) {
          lastErr = e;
          if (attempt >= delays.length - 1) throw e;
        }
      }
      throw lastErr;
    };

    const processOne = async (file: File, idx: number) => {
      if (cancelled) return;
      updateItem(idx, { status: "running" });
      try {
        const buf = await file.arrayBuffer();
        const hashBuf = await crypto.subtle.digest("SHA-256", buf);
        const file_hash = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, "0")).join("");

        const { data: existing } = await supabase
          .from("imported_romaneios")
          .select("id")
          .eq("file_hash", file_hash)
          .maybeSingle();
        if (existing) {
          skipped++;
          updateItem(idx, { status: "skip", msg: "já importado" });
          return;
        }

        const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("romaneios").upload(path, file);
        if (upErr) throw upErr;

        const data = await invokeWithRetry(path, file_hash, file.name);
        if (data?.error) throw new Error(data.error);
        if (data?.skipped) {
          skipped++;
          const isHash = data.reason === "hash";
          const label = isHash ? "já importado (arquivo idêntico)" : data.reason === "no_items" ? "IA não leu itens" : "duplicado";
          updateItem(idx, { status: "skip", msg: label, retriable: !isHash });
          return;
        }
        imported++;
        updateItem(idx, { status: "ok", msg: `${data.products_created || 0} novos · ${data.variants_added || 0} var · ${data.payable_created || 0} conta(s)${data.attempts > 1 ? ` · ${data.attempts}ª tent.` : ""}` });
        photosQueue.push(file);
      } catch (e: any) {
        failed++;
        updateItem(idx, { status: "err", msg: e?.message?.slice(0, 120) || "erro", retriable: true });
      }
    };

    // beforeunload guard
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);

    try {
      // concurrency pool = 3
      const CONCURRENCY = 3;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, pdfs.length) }, async () => {
        while (true) {
          if (cancelImportRef.current) cancelled = true;
          if (cancelled) return;
          const myIdx = cursor++;
          if (myIdx >= pdfs.length) return;
          await processOne(pdfs[myIdx], myIdx);
        }
      });
      await Promise.all(workers);

      toast.success(`Importação concluída: ${imported} importado(s), ${skipped} pulado(s), ${failed} com erro${cancelled ? " (cancelado)" : ""}`, { duration: 6000 });
      load();

      if (photosQueue.length) {
        toast.info(`Buscando fotos em ${photosQueue.length} PDF(s)...`);
        (async () => {
          let totalPhotos = 0;
          for (const f of photosQueue) {
            const res = await importRomaneioPhotos(f);
            totalPhotos += res.imported;
          }
          if (totalPhotos > 0) { toast.success(`${totalPhotos} foto(s) de produto importada(s)`); load(); }
        })();
      }
    } catch (e: any) {
      toast.error("Falha na importação: " + (e?.message || "erro desconhecido"));
    } finally {
      window.removeEventListener("beforeunload", beforeUnload);
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

      <Dialog open={importOpen} onOpenChange={(o) => { if (!importing) { setImportOpen(o); if (!o) { setImportFiles([]); setImportProgress([]); } } }}>
        <DialogContent className="glass-card border-white/40 max-w-lg">
          <DialogHeader><DialogTitle>Importar romaneios (PDF)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Anexe um ou vários PDFs. Processamos 3 em paralelo com repetição automática em caso de falha.
              Duplicados são detectados e pulados.
            </p>
            <div>
              <Label>Arquivos PDF</Label>
              <Input
                type="file"
                accept="application/pdf"
                multiple
                onChange={(e) => setImportFiles(Array.from(e.target.files ?? []))}
                disabled={importing}
                className="glass-input mt-1"
              />
              {importFiles.length > 0 && importProgress.length === 0 && (
                <ul className="text-xs text-muted-foreground mt-2 space-y-0.5 max-h-32 overflow-auto">
                  {importFiles.map((f, i) => <li key={i}>• {f.name}</li>)}
                </ul>
              )}
            </div>

            {importProgress.length > 0 && (() => {
              const done = importProgress.filter(p => p.status !== "pending" && p.status !== "running").length;
              const pct = Math.round((done / importProgress.length) * 100);
              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{done} de {importProgress.length} — {pct}%</span>
                    <span className="text-muted-foreground">
                      ✅ {importProgress.filter(p => p.status === "ok").length} ·
                      ⏭️ {importProgress.filter(p => p.status === "skip").length} ·
                      ❌ {importProgress.filter(p => p.status === "err").length}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <ul className="text-xs space-y-1 max-h-64 overflow-auto border rounded-lg p-2 bg-background/40">
                    {importProgress.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-4 shrink-0">
                          {p.status === "ok" && "✅"}
                          {p.status === "skip" && "⏭️"}
                          {p.status === "err" && "❌"}
                          {p.status === "running" && <Loader2 className="h-3 w-3 animate-spin inline" />}
                          {p.status === "pending" && "·"}
                        </span>
                        <span className="flex-1 truncate">{p.name}</span>
                        {p.msg && <span className="text-muted-foreground text-[10px] truncate max-w-[45%]">{p.msg}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            <div className="flex gap-2">
              <Button
                onClick={() => handleImport()}
                disabled={!importFiles.length || importing}
                className="flex-1 bg-gradient-primary text-primary-foreground rounded-xl"
              >
                {importing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processando...</>) : (<><FileUp className="h-4 w-4 mr-2" /> Importar {importFiles.length > 1 ? `${importFiles.length} romaneios` : "romaneio"}</>)}
              </Button>
              {importing && (
                <Button variant="outline" onClick={() => { cancelImportRef.current = true; toast.info("Cancelando após arquivos em voo..."); }} className="rounded-xl">
                  Cancelar
                </Button>
              )}
              {!importing && importProgress.length > 0 && importProgress.some((p) => p.retriable) && (
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => {
                    const retryNames = new Set(importProgress.filter((p) => p.retriable).map((p) => p.name));
                    const retryFiles = importFiles.filter((f) => retryNames.has(f.name));
                    if (!retryFiles.length) return;
                    setImportFiles(retryFiles);
                    setImportProgress([]);
                    setTimeout(() => handleImport(), 0);
                  }}
                >
                  Tentar novamente ({importProgress.filter((p) => p.retriable).length})
                </Button>
              )}
            </div>
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
