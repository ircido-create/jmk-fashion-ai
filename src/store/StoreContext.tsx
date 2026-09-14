import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { toast } from "sonner";
import { regionOf, type BodyRegion } from "@/lib/garments";
import { fetchCatalog, fetchStoreSettings } from "./api";
import {
  MAX_QTY_PER_LINE, lineKey, type CartLine, type StoreProduct, type StoreSettings,
} from "./types";

const CART_KEY = "jmk_store_cart_v1";
const LOOK_KEY = "jmk_store_look_v1";

/** Região do corpo → id do produto escolhido para o provador. */
export type Look = Partial<Record<BodyRegion, string>>;

// Sacola e look são conveniência do aparelho: storage bloqueado (aba anônima)
// não pode quebrar a loja, só deixar de lembrar.
function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sem storage: segue sem persistir
  }
}

interface StoreCtx {
  catalog: StoreProduct[];
  productById: Map<string, StoreProduct>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  settings: StoreSettings | null;

  cart: CartLine[];
  cartCount: number;
  cartTotal: number;
  addToCart: (line: CartLine) => void;
  setLineQty: (key: string, quantity: number) => void;
  removeLine: (key: string) => void;
  clearCart: () => void;

  look: Look;
  /** Devolve false quando a peça não pode ir ao provador (tipo não definido/"outro"). */
  setLookPiece: (product: StoreProduct) => boolean;
  removeLookPiece: (region: BodyRegion) => void;
  clearLook: () => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [cart, setCart] = useState<CartLine[]>(() => readJSON<CartLine[]>(CART_KEY, []));
  const [look, setLook] = useState<Look>(() => readJSON<Look>(LOOK_KEY, {}));

  const cartRef = useRef(cart);
  cartRef.current = cart;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await fetchCatalog());
    } catch {
      setError("Não foi possível carregar a coleção. Verifique sua conexão.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    fetchStoreSettings().then(setSettings).catch(() => setSettings(null));
  }, [reload]);

  useEffect(() => writeJSON(CART_KEY, cart), [cart]);
  useEffect(() => writeJSON(LOOK_KEY, look), [look]);

  const productById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  // A sacola guardada pode estar velha: peça vendida no PDV, preço alterado, ou
  // variação recriada pelo cadastro (que troca o id a cada edição). Reconcilia
  // com o catálogo atual para a cliente não descobrir isso só ao finalizar.
  useEffect(() => {
    if (loading || error) return;
    const prev = cartRef.current;
    const next: CartLine[] = [];
    let changed = false;
    for (const line of prev) {
      const p = productById.get(line.productId);
      if (!p) { changed = true; continue; }
      let available = MAX_QTY_PER_LINE;
      if (line.variantId) {
        const v = p.variants.find((x) => x.id === line.variantId);
        if (!v) { changed = true; continue; }
        available = v.quantity;
      } else if (p.variants.length > 0) {
        changed = true;
        continue;
      }
      const maxQty = Math.min(available, MAX_QTY_PER_LINE);
      const quantity = Math.min(line.quantity, maxQty);
      if (quantity !== line.quantity || maxQty !== line.maxQty || p.price !== line.price) changed = true;
      next.push({ ...line, price: p.price, maxQty, quantity });
    }
    if (changed) {
      setCart(next);
      if (next.length < prev.length) toast.info("Algumas peças da sua sacola esgotaram e saíram dela.");
    }
    setLook((cur) => {
      const kept: Look = {};
      let dropped = false;
      for (const [region, id] of Object.entries(cur) as [BodyRegion, string][]) {
        if (productById.has(id)) kept[region] = id;
        else dropped = true;
      }
      return dropped ? kept : cur;
    });
  }, [productById, loading, error]);

  const addToCart = useCallback((line: CartLine) => {
    setCart((c) => {
      const key = lineKey(line);
      const idx = c.findIndex((x) => lineKey(x) === key);
      if (idx < 0) return [...c, line];
      const next = [...c];
      next[idx] = { ...next[idx], quantity: Math.min(next[idx].maxQty, next[idx].quantity + line.quantity) };
      return next;
    });
  }, []);

  const setLineQty = useCallback((key: string, quantity: number) => {
    setCart((c) =>
      c.map((l) => (lineKey(l) === key ? { ...l, quantity: Math.max(1, Math.min(l.maxQty, quantity)) } : l)),
    );
  }, []);

  const removeLine = useCallback((key: string) => setCart((c) => c.filter((l) => lineKey(l) !== key)), []);
  const clearCart = useCallback(() => setCart([]), []);

  // Vestido/conjunto veste o corpo todo: exclui parte de cima e de baixo, e vice-versa.
  const setLookPiece = useCallback((product: StoreProduct) => {
    const region = regionOf(product.garment_type);
    if (!region) return false;
    setLook((cur) => {
      if (region === "full") return { full: product.id };
      const { full: _full, ...rest } = cur;
      return { ...rest, [region]: product.id };
    });
    return true;
  }, []);

  const removeLookPiece = useCallback((region: BodyRegion) => {
    setLook((cur) => {
      const next = { ...cur };
      delete next[region];
      return next;
    });
  }, []);

  const clearLook = useCallback(() => setLook({}), []);

  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);
  const cartTotal = Math.round(cart.reduce((s, l) => s + l.price * l.quantity, 0) * 100) / 100;

  const value: StoreCtx = {
    catalog, productById, loading, error, reload, settings,
    cart, cartCount, cartTotal, addToCart, setLineQty, removeLine, clearCart,
    look, setLookPiece, removeLookPiece, clearLook,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore precisa estar dentro de <StoreProvider>");
  return ctx;
}
