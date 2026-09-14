import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { fmtBRL } from "@/lib/utils";
import { GARMENT_PLURAL, regionOf } from "@/lib/garments";
import { displayName, type StoreProduct } from "../types";

export function ProductCard({ product, index = 0 }: { product: StoreProduct; index?: number }) {
  const canTryOn = !!regionOf(product.garment_type);
  const stock = product.variants.length ? product.variants.reduce((s, v) => s + v.quantity, 0) : null;
  const lowStock = stock !== null && stock <= 2;

  return (
    <Link
      to={`/loja/produto/${product.id}`}
      className="group block s-fade-up"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-[20px] border border-[color:var(--s-line)] bg-[color:var(--s-surface)]">
        <img
          src={product.image_url}
          alt={displayName(product.name)}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
        {/* Um contêiner só, com quebra de linha: em card estreito os dois selos
            lado a lado se sobrepunham. */}
        {(canTryOn || lowStock) && (
          <div className="absolute left-3 right-3 top-3 flex flex-wrap items-start gap-1.5">
            {canTryOn && (
              <span className="s-badge s-badge-ai">
                <Sparkles /> Provador IA
              </span>
            )}
            {lowStock && <span className="s-badge s-badge-gold">Últimas peças</span>}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-sm leading-snug">{displayName(product.name)}</h3>
        <span className="whitespace-nowrap text-sm font-semibold tabular-nums s-gold">{fmtBRL(product.price)}</span>
      </div>
      {product.garment_type && (
        <p className="s-eyebrow mt-1 !text-[10px]">{GARMENT_PLURAL[product.garment_type]}</p>
      )}
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div aria-hidden>
      <div className="aspect-[3/4] rounded-[20px] s-skeleton" />
      <div className="mt-3 h-4 w-3/4 rounded s-skeleton" />
      <div className="mt-2 h-3 w-1/3 rounded s-skeleton" />
    </div>
  );
}
