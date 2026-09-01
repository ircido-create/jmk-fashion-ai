import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { CartItem, Product } from "./types";

interface Props {
  /** Produto em escolha; null fecha o diálogo. */
  product: Product | null;
  onClose: () => void;
  onConfirm: (item: CartItem) => void;
}

/** Escolha de tamanho/cor quando o produto tem mais de uma variação em estoque. */
export function VariantPickerDialog({ product, onClose, onConfirm }: Props) {
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState(1);

  // Zera a escolha a cada produto novo: antes o estado morava no POS e podia
  // chegar preenchido do produto anterior.
  useEffect(() => {
    setVariantId("");
    setQty(1);
  }, [product?.id]);

  const confirm = () => {
    if (!product || !variantId) {
      toast.error("Selecione a variação");
      return;
    }
    const v = product.product_variants.find((x) => x.id === variantId)!;
    if (qty < 1 || qty > v.quantity) {
      toast.error(`Quantidade inválida (estoque: ${v.quantity})`);
      return;
    }
    onConfirm({
      productId: product.id,
      variantId: v.id,
      productName: product.name,
      variantLabel: [v.size, v.color].filter(Boolean).join(" / "),
      sku: v.sku ?? product.sku,
      quantity: qty,
      unitPrice: Number(product.price),
      unitCost: Number(product.cost),
      maxQty: v.quantity,
    });
    onClose();
  };

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle>{product?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Variação</Label>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger className="glass-input mt-1">
                <SelectValue placeholder="Selecione tamanho/cor" />
              </SelectTrigger>
              <SelectContent>
                {product?.product_variants.map((v) => (
                  <SelectItem key={v.id} value={v.id} disabled={v.quantity === 0}>
                    {[v.size, v.color].filter(Boolean).join(" / ") || "—"} (estoque: {v.quantity})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="glass-input mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirm} className="bg-gradient-primary text-primary-foreground">
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
