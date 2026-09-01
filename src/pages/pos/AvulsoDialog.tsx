import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { CartItem } from "./types";

interface Props {
  open: boolean;
  /** Pré-preenche o nome — o PDV passa o termo já digitado na busca. */
  initialName?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (item: CartItem) => void;
}

/** Item que não está no estoque — não afeta cadastro nem inventário. */
export function AvulsoDialog({ open, initialName = "", onOpenChange, onConfirm }: Props) {
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);

  // Reabrir o diálogo recomeça do termo buscado no momento da abertura.
  // De propósito só reage a `open`: seguir `initialName` apagaria o que já foi
  // digitado caso a busca do PDV mudasse com o diálogo aberto.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setPrice("");
      setQty(1);
    }

  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    const nome = name.trim();
    const valor = Number(String(price).replace(",", "."));
    const quantidade = Math.max(1, Math.floor(qty));
    if (!nome) {
      toast.error("Informe o nome");
      return;
    }
    if (!Number.isFinite(valor) || valor < 0) {
      toast.error("Valor inválido");
      return;
    }
    onConfirm({
      productId: `avulso-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      variantId: null,
      productName: nome,
      variantLabel: "",
      sku: null,
      quantity: quantidade,
      unitPrice: Math.round(valor * 100) / 100,
      unitCost: 0,
      maxQty: 9999,
      isAvulso: true,
    });
    onOpenChange(false);
    setName("");
    setPrice("");
    setQty(1);
    toast.success("Item avulso adicionado");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle>Produto avulso</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Adiciona um item que não está no estoque. Não afeta o cadastro de produtos nem o inventário.
          </p>
          <div>
            <Label htmlFor="avulso-nome">Nome do produto</Label>
            <Input
              id="avulso-nome"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Sacola personalizada"
              className="glass-input mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="avulso-valor">Valor unitário (R$)</Label>
              <Input
                id="avulso-valor"
                type="number"
                step="0.01"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0,00"
                className="glass-input mt-1"
              />
            </div>
            <div>
              <Label htmlFor="avulso-qtd">Quantidade</Label>
              <Input
                id="avulso-qtd"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="glass-input mt-1"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="bg-gradient-primary text-primary-foreground" onClick={add}>
            Adicionar ao carrinho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
