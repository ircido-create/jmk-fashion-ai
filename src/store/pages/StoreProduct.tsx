import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Minus, Plus, ShoppingBag, Sparkles, Store, Truck } from "lucide-react";
import { toast } from "sonner";
import { fmtBRL } from "@/lib/utils";
import { GARMENT_PLURAL, regionOf } from "@/lib/garments";
import { useStore } from "../StoreContext";
import { ProductCard } from "../components/ProductCard";
import { MAX_QTY_PER_LINE, displayName } from "../types";

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
/** Variação sem cor/tamanho vira a opção "" — o picker some quando é a única. */
const key = (v: string | null) => v ?? "";
const label = (v: string) => v || "Único";

export default function StoreProduct() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { catalog, productById, loading, addToCart, setLookPiece } = useStore();
  const product = id ? productById.get(id) : undefined;

  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState<string | null>(null);

  const colors = useMemo(() => uniq((product?.variants ?? []).map((v) => key(v.color))), [product]);
  const sizes = useMemo(
    () => uniq((product?.variants ?? []).filter((v) => key(v.color) === color).map((v) => key(v.size))),
    [product, color],
  );

  // Troca de produto (ou catálogo recarregado): reinicia a escolha e pré-seleciona
  // o que só tem uma opção, para não pedir um clique inútil.
  useEffect(() => {
    setQty(1);
    setActiveImg(null);
    setColor(colors.length === 1 ? colors[0] : "");
  }, [product?.id, colors]);

  useEffect(() => {
    setSize(sizes.length === 1 ? sizes[0] : "");
  }, [color, sizes]);

  const variant = product?.variants.find((v) => key(v.color) === color && key(v.size) === size) ?? null;
  const needsVariant = (product?.variants.length ?? 0) > 0;
  const maxQty = variant ? Math.min(variant.quantity, MAX_QTY_PER_LINE) : needsVariant ? 0 : MAX_QTY_PER_LINE;

  useEffect(() => {
    if (variant?.image_url) setActiveImg(variant.image_url);
  }, [variant?.image_url]);

  const region = regionOf(product?.garment_type);

  const suggestions = useMemo(() => {
    if (!product || !region) return [];
    // Parte de cima sugere parte de baixo e vice-versa: é o que monta um look.
    const want = region === "upper" ? ["lower"] : region === "lower" ? ["upper"] : ["full"];
    return catalog
      .filter((p) => p.id !== product.id && want.includes(regionOf(p.garment_type) ?? ""))
      .slice(0, 4);
  }, [catalog, product, region]);

  if (loading) {
    return (
      <div className="grid place-items-center py-40">
        <Loader2 className="h-6 w-6 animate-spin s-gold" aria-label="Carregando" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto max-w-xl px-4 py-32 text-center">
        <p className="s-display text-4xl">Peça indisponível</p>
        <p className="mt-3 s-muted">Ela pode ter esgotado ou saído da coleção.</p>
        <Link to="/loja" className="s-btn s-btn-gold mt-8">Ver a coleção</Link>
      </div>
    );
  }

  const images = uniq([product.image_url, ...product.variants.map((v) => v.image_url)].filter(Boolean) as string[]);
  const shownImg = activeImg ?? product.image_url;
  const name = displayName(product.name);

  const handleAdd = () => {
    if (needsVariant && !variant) {
      toast.error(colors.length > 1 && !color ? "Escolha a cor" : "Escolha o tamanho");
      return;
    }
    addToCart({
      productId: product.id,
      variantId: variant?.id ?? null,
      name: product.name,
      image: variant?.image_url ?? product.image_url,
      price: product.price,
      size: variant?.size ?? null,
      color: variant?.color ?? null,
      quantity: qty,
      maxQty,
    });
    toast.success("Adicionada à sacola", {
      action: { label: "Ver sacola", onClick: () => navigate("/loja/carrinho") },
    });
  };

  const handleTryOn = () => {
    if (setLookPiece(product)) navigate("/loja/provador");
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <Link to={product.garment_type ? `/loja?tipo=${product.garment_type}` : "/loja"} className="s-link s-muted inline-flex items-center gap-2 text-sm">
        <ArrowLeft className="h-4 w-4" />
        {product.garment_type ? GARMENT_PLURAL[product.garment_type] : "Coleção"}
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        {/* galeria */}
        <div className="s-fade-up">
          <div className="relative aspect-[3/4] overflow-hidden rounded-[24px] border border-[color:var(--s-line)] bg-[color:var(--s-surface)]">
            <img src={shownImg} alt={name} className="h-full w-full object-cover" />
            {region && (
              <span className="s-badge s-badge-ai absolute left-4 top-4">
                <Sparkles /> Provador IA
              </span>
            )}
          </div>
          {images.length > 1 && (
            <div className="no-scrollbar mt-4 flex gap-3 overflow-x-auto">
              {images.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setActiveImg(src)}
                  aria-label="Ver foto"
                  aria-pressed={shownImg === src}
                  className={`h-24 w-[72px] shrink-0 overflow-hidden rounded-xl border ${
                    shownImg === src ? "border-[color:var(--s-gold)]" : "border-[color:var(--s-line)]"
                  }`}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* detalhes */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          {product.garment_type && <p className="s-eyebrow">{GARMENT_PLURAL[product.garment_type]}</p>}
          <h1 className="s-display mt-3 text-4xl sm:text-5xl">{name}</h1>
          <p className="mt-5 text-3xl font-semibold tabular-nums s-gold">{fmtBRL(product.price)}</p>
          {product.description && <p className="mt-6 leading-relaxed s-muted">{product.description}</p>}

          {colors.length > 1 && (
            <fieldset className="mt-8">
              <legend className="s-label">Cor</legend>
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => (
                  <button key={c} type="button" className="s-chip" data-active={color === c} onClick={() => setColor(c)}>
                    {label(c)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {needsVariant && (colors.length <= 1 || color !== "") && sizes.length > 1 && (
            <fieldset className="mt-6">
              <legend className="s-label">Tamanho</legend>
              <div className="flex flex-wrap gap-2">
                {sizes.map((s) => (
                  <button key={s} type="button" className="s-chip min-w-[52px] justify-center" data-active={size === s} onClick={() => setSize(s)}>
                    {label(s)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {variant && variant.quantity <= 2 && (
            <p className="mt-4 text-sm s-gold">Restam só {variant.quantity} nesta opção.</p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <div className="flex h-12 items-center rounded-full border border-[color:var(--s-line-strong)]">
              <button
                type="button"
                className="s-icon-btn"
                onClick={() => setQty((n) => Math.max(1, n - 1))}
                disabled={qty <= 1}
                aria-label="Diminuir quantidade"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center tabular-nums" aria-live="polite">{qty}</span>
              <button
                type="button"
                className="s-icon-btn"
                onClick={() => setQty((n) => Math.min(Math.max(maxQty, 1), n + 1))}
                disabled={maxQty > 0 && qty >= maxQty}
                aria-label="Aumentar quantidade"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button type="button" className="s-btn s-btn-gold flex-1" onClick={handleAdd}>
              <ShoppingBag /> Adicionar à sacola
            </button>
          </div>

          {region ? (
            <button type="button" className="s-btn s-btn-ai mt-3 w-full" onClick={handleTryOn}>
              <Sparkles /> Experimentar no provador IA
            </button>
          ) : (
            <p className="mt-4 text-xs s-muted">Esta peça ainda não está disponível no provador virtual.</p>
          )}

          <ul className="mt-10 space-y-3 border-t pt-8 text-sm s-divider">
            <li className="flex gap-3 s-muted"><Check className="mt-0.5 h-4 w-4 shrink-0 s-gold" /> A peça fica reservada para você assim que o pedido é enviado.</li>
            <li className="flex gap-3 s-muted"><Store className="mt-0.5 h-4 w-4 shrink-0 s-gold" /> Retire na loja ou receba em casa.</li>
            <li className="flex gap-3 s-muted"><Truck className="mt-0.5 h-4 w-4 shrink-0 s-gold" /> Pagamento e entrega combinados com você pelo WhatsApp.</li>
          </ul>
        </div>
      </div>

      {suggestions.length > 0 && (
        <section className="mt-24">
          <p className="s-eyebrow">{region === "full" ? "Você também pode gostar" : "Monte o look"}</p>
          <h2 className="s-display mt-2 text-3xl sm:text-4xl">
            {region === "upper" ? "Combine com uma parte de baixo" : region === "lower" ? "Combine com uma parte de cima" : "Mais peças para provar"}
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-4">
            {suggestions.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
          </div>
        </section>
      )}
    </div>
  );
}
