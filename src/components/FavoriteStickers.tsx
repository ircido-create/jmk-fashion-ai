import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Sticker as StickerIcon, Plus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toStickerWebp } from "@/lib/imageToSticker";
import { cn } from "@/lib/utils";

interface FavoriteSticker {
  id: string;
  storage_path: string;
  public_url: string;
  created_by: string | null;
}

interface Props {
  disabled?: boolean;
  /** Recebe o arquivo .webp pronto pra envio (já 512x512 ≤100KB). */
  onSend: (file: File) => void | Promise<void>;
}

const BUCKET = "favorite-stickers";

export function FavoriteStickers({ disabled, onSend }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<FavoriteSticker[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("favorite_stickers")
      .select("id, storage_path, public_url, created_by")
      .order("created_at", { ascending: false });
    setItems((data as FavoriteSticker[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open]);

  const handleAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const sticker = await toStickerWebp(file);
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Sessão expirada");
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, sticker, { contentType: "image/webp", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const { error: insErr } = await supabase.from("favorite_stickers").insert({
        storage_path: path,
        public_url: pub.publicUrl,
        created_by: userId,
      });
      if (insErr) throw insErr;
      toast({ title: "Figurinha salva 💕" });
      await load();
    } catch (err: any) {
      toast({
        title: "Falha ao salvar figurinha",
        description: err?.message ?? "Erro",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async (s: FavoriteSticker) => {
    try {
      const res = await fetch(s.public_url);
      const blob = await res.blob();
      const file = new File([blob], `sticker-${s.id}.webp`, { type: "image/webp" });
      setOpen(false);
      await onSend(file);
    } catch (err: any) {
      toast({
        title: "Falha ao enviar figurinha",
        description: err?.message ?? "Erro",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (s: FavoriteSticker, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Remover esta figurinha dos favoritos?")) return;
    try {
      await supabase.storage.from(BUCKET).remove([s.storage_path]);
      await supabase.from("favorite_stickers").delete().eq("id", s.id);
      setItems((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err: any) {
      toast({ title: "Falha ao remover", description: err?.message, variant: "destructive" });
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAdd}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            disabled={disabled}
            aria-label="Figurinhas"
          >
            <StickerIcon className="h-5 w-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-[320px] p-0 glass-card overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-medium">Figurinhas favoritas</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Adicionar
                </>
              )}
            </Button>
          </div>
          <div className="h-[280px] overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-xs text-muted-foreground gap-2 px-4">
                <StickerIcon className="h-8 w-8 opacity-40" />
                <p>Nenhuma figurinha salva ainda.</p>
                <p>Toque em "Adicionar" para criar a primeira.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {items.map((s) => {
                  const isOwner = s.created_by === currentUserId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSend(s)}
                      className={cn(
                        "group relative aspect-square rounded-lg bg-background/40 hover:bg-background/70 transition flex items-center justify-center p-1",
                      )}
                    >
                      <img
                        src={s.public_url}
                        alt="figurinha"
                        className="max-w-full max-h-full object-contain"
                        loading="lazy"
                      />
                      {isOwner && (
                        <span
                          role="button"
                          onClick={(e) => handleDelete(s, e)}
                          className="absolute top-0.5 right-0.5 h-6 w-6 rounded-full bg-destructive/90 text-destructive-foreground opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                          aria-label="Remover"
                        >
                          <Trash2 className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
