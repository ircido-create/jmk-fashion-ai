import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CartItem, DiscountType } from "./types";

/**
 * Carrinho do PDV: itens, quantidades, preço unitário e desconto.
 *
 * Extraído de POS.tsx, onde convivia com catálogo, cliente, pagamento e cupom
 * no mesmo componente — qualquer tecla digitada na busca re-renderizava tudo.
 */
export function useCart() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountValue, setDiscountValue] = useState<string>("");
  const [discountType, setDiscountType] = useState<DiscountType>("valor");

  const subtotal = useMemo(
    () => cart.reduce((s, it) => s + it.unitPrice * it.quantity, 0),
    [cart],
  );

  const discountAmount = useMemo(() => {
    const raw = Number(String(discountValue).replace(",", ".")) || 0;
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    const val = discountType === "percent" ? (subtotal * raw) / 100 : raw;
    return Math.round(Math.min(Math.max(val, 0), subtotal) * 100) / 100;
  }, [discountValue, discountType, subtotal]);

  const total = Math.round((subtotal - discountAmount) * 100) / 100;

  const totalUnits = useMemo(
    () => cart.reduce((s, i) => s + i.quantity, 0),
    [cart],
  );

  /** Soma na linha existente quando produto e variação coincidem. */
  const pushItem = useCallback((item: CartItem) => {
    setCart((c) => {
      const idx = c.findIndex(
        (x) => x.productId === item.productId && x.variantId === item.variantId,
      );
      if (idx >= 0) {
        const next = [...c];
        next[idx] = {
          ...next[idx],
          quantity: Math.min(next[idx].maxQty, next[idx].quantity + item.quantity),
        };
        return next;
      }
      return [...c, item];
    });
  }, []);

  const updateQty = useCallback((idx: number, delta: number) => {
    setCart((c) => {
      const next = [...c];
      const item = { ...next[idx] };
      const q = item.quantity + delta;
      if (q < 1) {
        if (typeof window !== "undefined" && window.confirm(`Remover "${item.productName}" do carrinho?`)) {
          return c.filter((_, i) => i !== idx);
        }
        return c;
      }
      if (q > item.maxQty) {
        toast.error(`Apenas ${item.maxQty} unidade(s) em estoque`);
        return c;
      }
      item.quantity = q;
      next[idx] = item;
      return next;
    });
  }, []);

  const setQtyExact = useCallback((idx: number, raw: string) => {
    const parsed = Math.floor(Number(raw));
    setCart((c) => {
      const next = [...c];
      const item = { ...next[idx] };
      if (!Number.isFinite(parsed) || parsed < 1) return c;
      if (parsed > item.maxQty) {
        toast.error(`Apenas ${item.maxQty} unidade(s) em estoque`);
        item.quantity = item.maxQty;
      } else {
        item.quantity = parsed;
      }
      next[idx] = item;
      return next;
    });
  }, []);

  const setUnitPrice = useCallback((idx: number, raw: string) => {
    const parsed = Number(String(raw).replace(",", "."));
    setCart((c) => {
      if (!Number.isFinite(parsed) || parsed < 0) return c;
      const next = [...c];
      next[idx] = { ...next[idx], unitPrice: Math.round(parsed * 100) / 100 };
      return next;
    });
  }, []);

  const removeItem = useCallback(
    (idx: number) => setCart((c) => c.filter((_, i) => i !== idx)),
    [],
  );

  const reset = useCallback(() => {
    setCart([]);
    setDiscountValue("");
    setDiscountType("valor");
  }, []);

  return {
    cart,
    subtotal,
    total,
    totalUnits,
    discountValue,
    setDiscountValue,
    discountType,
    setDiscountType,
    discountAmount,
    pushItem,
    updateQty,
    setQtyExact,
    setUnitPrice,
    removeItem,
    reset,
  };
}
