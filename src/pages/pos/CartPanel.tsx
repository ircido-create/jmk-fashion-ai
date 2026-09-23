import { GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { fmtBRL } from "@/lib/utils";
import type { useCart } from "./useCart";
import type { Customer } from "./types";

interface Props {
  cartApi: ReturnType<typeof useCart>;
  onClear: () => void;
  /** Cliente escolhida (null enquanto não há). */
  customer: Customer | null;
  debt: number | null;
  debtLoading: boolean;
}

/** Carrinho da lateral: itens, quantidades, preço, desconto, total e dívida da cliente. */
export function CartPanel({ cartApi, onClear, customer, debt, debtLoading }: Props) {
  const {
    cart, subtotal, total, totalUnits,
    discountValue, setDiscountValue, discountType, setDiscountType, discountAmount,
    updateQty, setQtyExact, setUnitPrice, removeItem,
  } = cartApi;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" /> Carrinho
        </h3>
        {cart.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs">
            Limpar
          </Button>
        )}
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {cart.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum item no carrinho
          </p>
        )}
        {cart.map((it, i) => (
          <div key={i} className="rounded-lg border border-border bg-white/40 dark:bg-white/5 p-2">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{it.productName}</div>
                {it.variantLabel && (
                  <div className="text-xs text-muted-foreground">{it.variantLabel}</div>
                )}
              </div>
              <button
                onClick={() => removeItem(i)}
                className="text-destructive hover:opacity-70"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-6 w-6"
                  onClick={() => updateQty(i, -1)}
                  disabled={it.quantity <= 1}
                  aria-label="Diminuir quantidade"
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={it.maxQty}
                  value={it.quantity}
                  onChange={(e) => setQtyExact(i, e.target.value)}
                  onBlur={(e) => {
                    if (!e.target.value || Number(e.target.value) < 1) setQtyExact(i, "1");
                  }}
                  className="h-6 w-12 px-1 text-center text-sm glass-input"
                  aria-label="Quantidade"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-6 w-6"
                  onClick={() => updateQty(i, 1)}
                  disabled={it.quantity >= it.maxQty}
                  aria-label="Aumentar quantidade"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">R$</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={it.unitPrice}
                  onChange={(e) => setUnitPrice(i, e.target.value)}
                  onBlur={(e) => {
                    if (!e.target.value || Number(e.target.value) < 0) setUnitPrice(i, "0");
                  }}
                  className="h-6 w-20 px-1 text-right text-sm glass-input"
                  aria-label="Preço unitário"
                />
                <span className="text-sm font-semibold ml-1">= {fmtBRL(it.unitPrice * it.quantity)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Os totais mudam a cada item somado ao carrinho sem que nada receba
          foco; sem aria-live o leitor de tela não anuncia a alteração. */}
      <div
        className="border-t border-border mt-3 pt-3 space-y-1"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Itens:</span>
          <span>{totalUnits}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal:</span>
          <span>{fmtBRL(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Desconto:</span>
          <div className="flex items-center gap-1">
            <div className="flex rounded-md overflow-hidden border border-border">
              <button
                type="button"
                onClick={() => setDiscountType("valor")}
                className={`px-2 py-0.5 text-xs ${discountType === "valor" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground"}`}
                aria-pressed={discountType === "valor"}
              >
                R$
              </button>
              <button
                type="button"
                onClick={() => setDiscountType("percent")}
                className={`px-2 py-0.5 text-xs ${discountType === "percent" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground"}`}
                aria-pressed={discountType === "percent"}
              >
                %
              </button>
            </div>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder="0"
              className="h-7 w-24 px-2 text-right text-sm glass-input"
              aria-label="Desconto"
            />
          </div>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-sm text-destructive">
            <span>Desconto aplicado:</span>
            <span>- {fmtBRL(discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-lg">
          <span>Total:</span>
          <span className="text-primary">{fmtBRL(total)}</span>
        </div>
        {customer && (
          <div className="text-xs text-muted-foreground pt-1 space-y-1">
            <div>
              Cliente: <span className="font-medium text-foreground">{customer.name}</span>
            </div>
            <div className="flex items-center justify-between" aria-live="polite">
              <span>Dívida Total:</span>
              {debtLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (debt ?? 0) > 0 ? (
                <span className="font-semibold text-destructive">{fmtBRL(debt ?? 0)}</span>
              ) : (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">Nenhuma dívida</span>
              )}
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
