import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Camera, X, Image as ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Variant { id: string; size: string | null; color: string | null; image_url: string | null; quantity: number; }
interface Product {
  id: string; name: string; supplier: string | null; price: number;
  image_url: string | null; product_variants: Variant[];
}
interface StatusPost {
  id: string; product_id: string; variant_id: string | null;
  image_url: string | null; caption: string | null;
  posted_at: string; expires_at: string;
}

export default function Status() {
  const [products, setProducts] = useState<Product[]>([]);
  const [posts, setPosts] = useState<StatusPost[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: prods }, { data: ps }] = await Promise.all([
      supabase.from("products").select("id,name,supplier,price,image_url,product_variants(id,size,color,image_url,quantity)").eq("active", true).order("name"),
      supabase.from("status_posts").select("*").gt("expires_at", new Date().toISOString()).order("posted_at", { ascending: false }),
    ]);
    setProducts((prods as any) ?? []);
    setPosts((ps as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const activeKey = (productId: string, variantId?: string | null) =>
    posts.find(p => p.product_id === productId && (p.variant_id ?? null) === (variantId ?? null));

  const toggle = async (product: Product, variant?: Variant) => {
    const existing = activeKey(product.id, variant?.id);
    if (existing) {
      const { error } = await supabase.from("status_posts").delete().eq("id", existing.id);
      if (error) return toast.error("Erro ao remover");
      toast.success("Removido do status");
    } else {
      const image = variant?.image_url || product.image_url;
      const { error } = await supabase.from("status_posts").insert({
        product_id: product.id,
        variant_id: variant?.id ?? null,
        image_url: image,
        caption: variant ? `${product.name} — ${[variant.size, variant.color].filter(Boolean).join("/")}` : product.name,
      });
      if (error) return toast.error("Erro ao adicionar");
      toast.success("Adicionado ao status (24h)");
    }
    load();
  };

  const clearAll = async () => {
    if (!confirm("Limpar todas as peças do status?")) return;
    const ids = posts.map(p => p.id);
    if (!ids.length) return;
    await supabase.from("status_posts").delete().in("id", ids);
    toast.success("Status limpo");
    load();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.supplier ?? "").toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Status do Dia"
        description="Marque as peças que você acabou de postar no status do WhatsApp. A Mônica usará essas peças para entender quando o cliente responder ao status."
      />

      <GlassCard className="p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar peça ou fornecedor..." className="pl-9" />
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-muted-foreground">
              <strong className="text-foreground">{posts.length}</strong> peça(s) ativa(s)
            </div>
            {posts.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearAll}>
                <Trash2 className="h-4 w-4 mr-2" /> Limpar
              </Button>
            )}
          </div>
        </div>
      </GlassCard>

      {posts.length > 0 && (
        <GlassCard className="p-4">
          <div className="text-sm font-medium mb-3">No status agora</div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {posts.map(p => (
              <div key={p.id} className="relative shrink-0 w-24">
                <div className="aspect-square rounded-lg overflow-hidden bg-muted ring-2 ring-primary">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.caption ?? ""} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>
                  )}
                </div>
                <button
                  onClick={async () => { await supabase.from("status_posts").delete().eq("id", p.id); load(); }}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                  aria-label="Remover"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="text-[10px] text-muted-foreground mt-1 truncate">{p.caption}</div>
                <div className="text-[10px] text-muted-foreground">expira {formatDistanceToNow(new Date(p.expires_at), { locale: ptBR, addSuffix: true })}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando...</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map((p) => {
            const variantsWithImage = p.product_variants?.filter(v => v.image_url) ?? [];
            const productActive = !!activeKey(p.id, null);
            return (
              <GlassCard key={p.id} className="p-3 space-y-2">
                <button onClick={() => toggle(p)} className="block w-full">
                  <div className={`aspect-square rounded-lg overflow-hidden bg-muted ${productActive ? "ring-2 ring-primary" : ""}`}>
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full grid place-items-center"><ImageIcon className="h-8 w-8 text-muted-foreground" /></div>
                    )}
                  </div>
                </button>
                <div>
                  <div className="text-sm font-medium truncate" title={p.name}>{p.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.supplier ?? "—"}</div>
                </div>
                <Button
                  size="sm"
                  variant={productActive ? "default" : "outline"}
                  className="w-full"
                  onClick={() => toggle(p)}
                >
                  {productActive ? "No status ✓" : "Postar no status"}
                </Button>
                {variantsWithImage.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1 border-t border-border">
                    {variantsWithImage.map(v => {
                      const va = !!activeKey(p.id, v.id);
                      return (
                        <button
                          key={v.id}
                          onClick={() => toggle(p, v)}
                          className={`relative w-10 h-10 rounded overflow-hidden ${va ? "ring-2 ring-primary" : "ring-1 ring-border"}`}
                          title={[v.size, v.color].filter(Boolean).join("/")}
                        >
                          <img src={v.image_url!} alt="" className="w-full h-full object-cover" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
