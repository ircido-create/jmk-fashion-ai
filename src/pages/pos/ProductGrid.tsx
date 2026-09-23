import { GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ShoppingCart } from "lucide-react";
import { fmtBRL } from "@/lib/utils";
import type { Product } from "./types";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  products: Product[];
  onPick: (p: Product) => void;
  onAvulso: () => void;
}

/** Passo 1 do PDV: busca e grade de produtos. */
export function ProductGrid({ search, onSearchChange, products, onPick, onAvulso }: Props) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          autoFocus
          placeholder="Buscar por nome ou SKU…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="glass-input"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-xl whitespace-nowrap"
          onClick={onAvulso}
        >
          <Plus className="h-4 w-4 mr-1" /> Produto avulso
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto pr-1">
        {products.map((p) => {
          const stock = p.product_variants.reduce((s, v) => s + v.quantity, 0);
          return (
            <button
              key={p.id}
              onClick={() => onPick(p)}
              disabled={stock === 0 && p.product_variants.length > 0}
              className="group text-left rounded-xl border border-border bg-white/40 dark:bg-white/5 backdrop-blur p-2 hover:shadow-glow hover:border-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="aspect-square rounded-lg overflow-hidden bg-muted mb-2 flex items-center justify-center">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <ShoppingCart className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="text-xs font-medium line-clamp-2">{p.name}</div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs font-bold text-primary">{fmtBRL(p.price)}</span>
                <span className="text-[10px] text-muted-foreground">est: {stock}</span>
              </div>
            </button>
          );
        })}
        {products.length === 0 && (
          <div className="col-span-full text-center text-sm text-muted-foreground py-6">
            Nenhum produto encontrado
          </div>
        )}
      </div>
    </GlassCard>
  );
}
