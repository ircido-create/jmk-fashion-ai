import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";

/**
 * Campanha de Black Friday da loja.
 *
 * Fica no código mesmo, e não no banco, porque é peça de comunicação e muda de
 * ano em ano junto com a arte. Para encerrar antes da data, troque
 * CAMPANHA_ATIVA para false e publique; depois do prazo ela some sozinha, para
 * ninguém esquecer um "Black Friday" no ar em janeiro.
 */
const CAMPANHA_ATIVA = true;
/** Fim do esquenta: a Black Friday de 2026 cai em 27/11. */
const CAMPANHA_ATE = new Date("2026-11-28T23:59:59-03:00");

export function campanhaNoAr(): boolean {
  return CAMPANHA_ATIVA && Date.now() <= CAMPANHA_ATE.getTime();
}

/** Faixa fina, acima do cabeçalho, em todas as páginas da loja. */
export function BlackFridayStrip() {
  if (!campanhaNoAr()) return null;
  return (
    <div className="relative z-50 overflow-hidden border-b border-[color:var(--s-gold)]/30 bg-[linear-gradient(90deg,#120f0a,#1d170d_45%,#120f0a)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-[11px] sm:text-xs">
        <span className="font-bold uppercase tracking-[0.22em] s-gold">Esquenta Black Friday</span>
        <span className="s-muted">10% a 50% OFF em peças selecionadas</span>
        <span className="hidden s-muted sm:inline">·</span>
        <span className="s-muted">PIX ou até 5x</span>
      </div>
    </div>
  );
}

/** Bloco de campanha no topo da vitrine. */
export function BlackFridayHero() {
  if (!campanhaNoAr()) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
      <div className="relative overflow-hidden rounded-[28px] border border-[color:var(--s-gold)]/40 bg-[radial-gradient(120%_120%_at_0%_0%,#1f1709_0%,#0d0b08_55%,#000_100%)] px-6 py-10 sm:px-12 sm:py-14">
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[color:var(--s-gold)]/20 blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <p className="s-eyebrow">Esquenta</p>
          <h2 className="s-display mt-2 text-5xl leading-[0.95] sm:text-7xl">
            Black <span className="s-gold">Friday</span>
          </h2>
          <p className="mt-4 text-sm uppercase tracking-[0.3em] s-muted">Ofertas imperdíveis</p>

          <div className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-2">
            <span className="s-display text-6xl leading-none s-gold sm:text-7xl">10% a 50%</span>
            <span className="s-display text-3xl leading-none sm:text-4xl">OFF</span>
          </div>
          <p className="mt-2 text-sm uppercase tracking-[0.2em] s-muted">em peças selecionadas</p>

          <div className="mt-8 rounded-2xl border border-[color:var(--s-line)] bg-black/30 px-5 py-4">
            <p className="text-base font-semibold sm:text-lg">
              Pague com <span className="s-gold">PIX</span> ou parcele em até <span className="s-gold">5x</span>
            </p>
            <p className="mt-1 text-xs s-muted">Parcelamento com juros para o cliente.</p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#colecao" className="s-btn s-btn-gold">
              Ver as ofertas
            </a>
            <Link to="/loja/provador" className="s-btn s-btn-ai">
              <Sparkles /> Experimentar com IA
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
