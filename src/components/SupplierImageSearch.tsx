import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Search, ImageIcon, Check, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ImageCandidate {
  url: string;
  score: number;
  source: string;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productName: string;
  supplier?: string | null;
  /** When set, "Aplicar" salva como image_url da variação */
  variantId?: string;
  /** When set, "Aplicar" salva como imagem principal do produto */
  productId?: string;
  /** Quando true e productId definido, propaga a foto para todas variações sem foto */
  applyToAllVariants?: boolean;
  /** Chamado depois de salvar com a URL final salva no storage */
  onSaved?: (publicUrl: string) => void;
}

export default function SupplierImageSearch({
  open,
  onOpenChange,
  productName,
  supplier,
  variantId,
  productId,
  applyToAllVariants,
  onSaved,
}: Props) {
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [images, setImages] = useState<ImageCandidate[]>([]);
  const [domainOverride, setDomainOverride] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const search = async () => {
    if (!productName) {
      toast.error("Nome do produto é obrigatório");
      return;
    }
    setSearching(true);
    setImages([]);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("find-product-image", {
        body: {
          action: "find",
          product_name: productName,
          supplier: supplier || undefined,
          domain_override: domainOverride.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setImages(data.images || []);
      if (!data.images?.length) {
        setMessage(data.message || "Nenhuma imagem encontrada. Tente informar o site do fornecedor.");
      }
    } catch (e: any) {
      toast.error("Falha na busca: " + (e?.message || "erro"));
    } finally {
      setSearching(false);
    }
  };

  /**
   * Foto escolhida no computador. Nem toda peça está no site do fornecedor —
   * muita coisa é foto tirada na loja mesmo. Sobe direto para o nosso storage
   * e faz o mesmo vínculo que a busca faria.
   */
  const uploadLocal = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem muito grande (máx 5MB)"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("product-images").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const url = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;

      // Peça ou variação já gravada: o vínculo vai agora. Variação nova (sem id)
      // fica só no formulário e é gravada junto com o produto.
      if (variantId) {
        const { error } = await supabase.from("product_variants").update({ image_url: url }).eq("id", variantId);
        if (error) throw error;
      }
      if (productId) {
        const { error } = await supabase.from("products").update({ image_url: url }).eq("id", productId);
        if (error) throw error;
        if (applyToAllVariants) {
          await supabase.from("product_variants").update({ image_url: url })
            .eq("product_id", productId).is("image_url", null);
        }
      }
      toast.success("Foto enviada");
      onSaved?.(url);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Falha ao enviar: " + (e?.message || "erro"));
    } finally {
      setUploading(false);
    }
  };

  const choose = async (url: string) => {
    setSaving(url);
    try {
      const { data, error } = await supabase.functions.invoke("find-product-image", {
        body: {
          action: "save",
          image_url: url,
          variant_id: variantId,
          product_id: productId,
          apply_to_all_variants: applyToAllVariants,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Imagem salva");
      onSaved?.(data.image_url);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Falha ao salvar: " + (e?.message || "erro"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Buscar imagem do fornecedor</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Buscando: <span className="font-medium text-foreground">{productName}</span>
            {supplier && (
              <>
                {" "}
                em <span className="font-medium text-foreground">{supplier}</span>
              </>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <Label className="text-xs">Site do fornecedor (opcional)</Label>
              <Input
                value={domainOverride}
                onChange={(e) => setDomainOverride(e.target.value)}
                placeholder="ex: tatamartelo.com"
                className="glass-input"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={search} disabled={searching || uploading} className="rounded-xl">
                {searching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                Buscar
              </Button>
              <Button asChild variant="outline" className="rounded-xl" disabled={uploading}>
                <label className="cursor-pointer">
                  {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                  {uploading ? "Enviando..." : "Do computador"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) uploadLocal(file);
                    }}
                  />
                </label>
              </Button>
            </div>
          </div>

          {message && (
            <div className="text-sm text-muted-foreground p-3 rounded-xl bg-muted/40">{message}</div>
          )}

          {images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {images.map((img) => (
                <div
                  key={img.url}
                  className="relative group rounded-xl overflow-hidden border border-border bg-white/30 backdrop-blur"
                >
                  <div className="aspect-square bg-muted/30">
                    <img
                      src={img.url}
                      alt={img.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget.parentElement as HTMLElement).innerHTML =
                          '<div class="h-full w-full flex items-center justify-center text-muted-foreground"><span class="text-xs">erro ao carregar</span></div>';
                      }}
                    />
                  </div>
                  <div className="p-2 space-y-1">
                    {img.score > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        Match {Math.round(img.score * 100)}%
                      </div>
                    )}
                    <Button
                      size="sm"
                      className="w-full rounded-lg text-xs"
                      disabled={saving !== null}
                      onClick={() => choose(img.url)}
                    >
                      {saving === img.url ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-3 w-3 mr-1" /> Usar
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!searching && images.length === 0 && !message && (
            <div className="text-center py-12 text-muted-foreground">
              <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm">
                Clique em Buscar para procurar no site do fornecedor — ou use "Do computador" para
                enviar uma foto sua.
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
