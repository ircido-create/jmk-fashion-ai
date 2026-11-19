import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, RefreshCw, Search, Sparkles } from "lucide-react";
import { GARMENT_PLURAL, GARMENT_TYPES, isGarmentType, regionOf, type GarmentType } from "@/lib/garments";
import { useSeo } from "@/lib/seo";
import { useStore } from "../StoreContext";
import { BlackFridayHero, campanhaNoAr } from "../components/BlackFriday";
import { ProductCard, ProductCardSkeleton } from "../components/ProductCard";
import { chaveDoTamanho, gradeDaPeca, ordenarTamanhos, rotuloDoTamanho } from "../seoDaPeca";
import { displayName, offerOf, type StoreProduct } from "../types";

type Sort = "novidades" | "menor" | "maior";

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export default function StoreHome() {
  const { catalog, loading, error, reload } = useStore();
  const [params, setParams] = useSearchParams();
  const tipoParam = params.get("tipo");
  const tipo = isGarmentType(tipoParam) ? tipoParam : null;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("novidades");

  /**
   * Filtro da Black Friday (`?oferta=1`). Peça em oferta é a que tem preço "De"
   * maior que o de hoje — a mesma conta que põe o selo no card, para a cliente
   * nunca ver uma lista que não bate com o que ela vê nas fotos.
   */
  const soOfertas = params.get("oferta") === "1" && campanhaNoAr();
  const base = useMemo(
    () => (soOfertas ? catalog.filter((p) => offerOf(p)) : catalog),
    [catalog, soOfertas],
  );
  const quantasOfertas = useMemo(() => catalog.filter((p) => offerOf(p)).length, [catalog]);

  /**
   * Filtro de tamanho (`?tamanho=M`), um de cada vez: clicar em "GG+" troca o
   * "P" que estava ligado, em vez de somar os dois. Clicar no que já está
   * ligado desliga.
   *
   * Vale o tamanho COM estoque, pela mesma conta que desenha a grade na página
   * da peça. Mostrar a peça cujo M já acabou seria pior que não ter filtro.
   *
   * A leitura fica no primeiro valor: link antigo com `?tamanho=M,G` abre no M,
   * e não numa tela em que dois chips acesos contradizem a regra.
   */
  const tamanho = useMemo(() => {
    const bruto = params.get("tamanho") ?? "";
    return chaveDoTamanho(bruto.split(",")[0] ?? "") || null;
  }, [params]);

  const gradeDe = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of catalog) m.set(p.id, gradeDaPeca(p).tamanhos.map(chaveDoTamanho));
    return m;
  }, [catalog]);

  const serveNoTamanho = useMemo(() => {
    if (!tamanho) return () => true;
    return (p: StoreProduct) => (gradeDe.get(p.id) ?? []).includes(tamanho);
  }, [gradeDe, tamanho]);

  // as contagens das abas seguem os outros filtros ligados: dizer "Saias 3" e abrir com 1 confunde
  const counts = useMemo(() => {
    const c = new Map<GarmentType, number>();
    for (const p of base) {
      if (p.garment_type && serveNoTamanho(p)) c.set(p.garment_type, (c.get(p.garment_type) ?? 0) + 1);
    }
    return c;
  }, [base, serveNoTamanho]);

  /**
   * Os chips de tamanho: só os que existem hoje, na ordem da grade. A conta
   * ignora o próprio filtro de tamanho (senão clicar em "M" zeraria os outros)
   * mas respeita o tipo e a oferta — é o que a cliente veria ao clicar.
   */
  const tamanhos = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of base) {
      if (tipo && p.garment_type !== tipo) continue;
      for (const t of gradeDe.get(p.id) ?? []) c.set(t, (c.get(t) ?? 0) + 1);
    }
    return ordenarTamanhos([...c.keys()]).map((t) => ({
      chave: t,
      rotulo: rotuloDoTamanho(t),
      pecas: c.get(t) ?? 0,
    }));
  }, [base, gradeDe, tipo]);

  const list = useMemo(() => {
    const term = normalize(q.trim());
    // o servidor já devolve das mais novas para as mais antigas
    // Sem corte: a vitrine mostra todas as peças que o banco liberou para a loja.
    // Havia um teto de 10 aqui, e as mais antigas sumiam sem que ninguém soubesse
    // — em 13/11/2026 eram 13 peças marcadas e 10 à vista. As fotos dos cards
    // são loading="lazy", então o catálogo inteiro não pesa na abertura.
    const filtered = base.filter(
      (p) =>
        (!tipo || p.garment_type === tipo) &&
        (!term || normalize(p.name).includes(term)) &&
        serveNoTamanho(p),
    );
    if (sort === "menor") return [...filtered].sort((a, b) => a.price - b.price);
    if (sort === "maior") return [...filtered].sort((a, b) => b.price - a.price);
    return filtered;
  }, [base, tipo, q, sort, serveNoTamanho]);

  useSeo(seoDaVitrine(tipo, list.length));

  const setFiltros = (mudanca: { tipo?: GarmentType | null; oferta?: boolean; tamanho?: string | null }) => {
    const t = mudanca.tipo !== undefined ? mudanca.tipo : tipo;
    const oferta = mudanca.oferta !== undefined ? mudanca.oferta : soOfertas;
    const tam = mudanca.tamanho !== undefined ? mudanca.tamanho : tamanho;
    const next = new URLSearchParams(params);
    if (t) next.set("tipo", t);
    else next.delete("tipo");
    if (oferta) next.set("oferta", "1");
    else next.delete("oferta");
    // na URL vai o tamanho como a cliente lê ("GG+"), para o link que ela manda
    // pela amiga fazer sentido; a comparação é sempre pela chave normalizada.
    if (tam) next.set("tamanho", rotuloDoTamanho(tam));
    else next.delete("tamanho");
    setParams(next, { replace: true });
  };
  const setTipo = (t: GarmentType | null) => setFiltros({ tipo: t });
  const limparTudo = () => setFiltros({ tipo: null, oferta: false, tamanho: null });

  /** Um tamanho por vez: o novo entra no lugar do anterior; o mesmo desliga. */
  const escolherTamanho = (chave: string) =>
    setFiltros({ tamanho: tamanho === chave ? null : chave });

  /** O botão do banner: liga o filtro e desce até a coleção. */
  const verOfertas = () => {
    setFiltros({ tipo: null, oferta: true });
    document.getElementById("colecao")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const showHero = !tipo;

  return (
    <>
      <BlackFridayHero onVerOfertas={verOfertas} />
      {showHero && <Hero catalog={catalog} />}

      <section id="colecao" className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-12 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="s-eyebrow">Coleção</p>
            <h2 className="s-display mt-2 text-4xl sm:text-5xl">
              {soOfertas
                ? tipo ? `${GARMENT_PLURAL[tipo]} em oferta` : "Ofertas Black Friday"
                : tipo ? GARMENT_PLURAL[tipo] : "Novidades"}
            </h2>
          </div>
          {!loading && !error && (
            <p className="text-sm s-muted">
              {list.length} {list.length === 1 ? "peça" : "peças"}
            </p>
          )}
        </div>

        <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            <button
              type="button"
              className="s-chip"
              data-active={!tipo && !soOfertas && !tamanho}
              onClick={limparTudo}
            >
              Tudo
            </button>
            {campanhaNoAr() && quantasOfertas > 0 && (
              <button
                type="button"
                className="s-chip"
                data-active={soOfertas}
                onClick={() => setFiltros({ oferta: !soOfertas })}
              >
                Black Friday <span className="s-chip-count">{quantasOfertas}</span>
              </button>
            )}
            {GARMENT_TYPES.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => (
              <button key={t} type="button" className="s-chip" data-active={tipo === t} onClick={() => setTipo(t)}>
                {GARMENT_PLURAL[t]} <span className="s-chip-count">{counts.get(t) ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="flex gap-3 lg:ml-auto">
            <label className="relative flex-1 lg:w-72 lg:flex-none">
              <span className="sr-only">Buscar peças</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 s-muted" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar peças"
                className="s-input !pl-11"
              />
            </label>
            <label className="relative">
              <span className="sr-only">Ordenar</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="s-input w-auto">
                <option value="novidades">Novidades</option>
                <option value="menor">Menor preço</option>
                <option value="maior">Maior preço</option>
              </select>
            </label>
          </div>
        </div>

        {/*
          A grade fica numa linha própria, com rótulo: os chips de cima são o
          que a peça é, estes são o que serve na cliente. Misturar os dois na
          mesma fila faria "Saias" e "M" parecerem a mesma escolha.
        */}
        {!loading && !error && tamanhos.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wider s-muted">Tamanho</span>
            {tamanhos.map((t) => (
              <button
                key={t.chave}
                type="button"
                className="s-chip"
                data-active={tamanho === t.chave}
                aria-pressed={tamanho === t.chave}
                onClick={() => escolherTamanho(t.chave)}
              >
                {t.rotulo} <span className="s-chip-count">{t.pecas}</span>
              </button>
            ))}
            {tamanho && (
              <button
                type="button"
                className="ml-1 text-xs underline underline-offset-4 s-muted"
                onClick={() => setFiltros({ tamanho: null })}
              >
                limpar tamanho
              </button>
            )}
          </div>
        )}

        <div className="mt-10">
          {error ? (
            <div className="s-card flex flex-col items-center gap-4 px-6 py-16 text-center">
              <p className="s-muted">{error}</p>
              <button type="button" className="s-btn s-btn-ghost" onClick={() => reload()}>
                <RefreshCw /> Tentar de novo
              </button>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          ) : list.length === 0 ? (
            <div className="s-card px-6 py-16 text-center">
              <p className="s-display text-2xl">Nenhuma peça encontrada</p>
              <p className="mt-2 text-sm s-muted">
                {tamanho
                  ? "Nenhuma peça nesse tamanho com os outros filtros ligados. Tente outro tamanho ou veja a coleção completa."
                  : "Tente outra busca ou veja a coleção completa."}
              </p>
              <button type="button" className="s-btn s-btn-ghost mt-6" onClick={() => { setQ(""); limparTudo(); }}>
                Ver tudo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
            </div>
          )}
        </div>
      </section>

      {!loading && !error && <FittingRoomBanner />}
    </>
  );
}

function Hero({ catalog }: { catalog: StoreProduct[] }) {
  // Três peças que o provador aceita, para a vitrine já mostrar o que ele faz.
  const showcase = useMemo(() => {
    const eligible = catalog.filter((p) => regionOf(p.garment_type));
    return (eligible.length >= 3 ? eligible : catalog).slice(0, 3);
  }, [catalog]);

  return (
    <section className="relative overflow-hidden">
      <div className="s-gridlines pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-20">
        <div className="s-fade-up">
          <p className="s-eyebrow">Nova coleção · Moda feminina</p>
          <h1 className="s-display mt-5 text-5xl sm:text-6xl lg:text-7xl">
            Elegância que você <em className="s-gold not-italic">experimenta</em> antes de vestir.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed s-muted sm:text-lg">
            Escolha suas peças, monte o look — uma blusa com uma saia, um vestido, um conjunto — e veja o
            resultado em você com o nosso provador de <span className="s-ai-text font-semibold">inteligência artificial</span>.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#colecao" className="s-btn s-btn-gold">
              Ver coleção <ArrowRight />
            </a>
            <Link to="/loja/provador" className="s-btn s-btn-ai">
              <Sparkles /> Experimentar com IA
            </Link>
          </div>
        </div>

        <div className="relative hidden h-[520px] lg:block" aria-hidden>
          {showcase[0] && (
            <HeroImage p={showcase[0]} className="absolute right-0 top-0 h-[440px] w-[300px] rotate-[3deg]" />
          )}
          {showcase[1] && (
            <HeroImage p={showcase[1]} className="absolute bottom-0 left-6 h-[340px] w-[240px] -rotate-[4deg]" />
          )}
          {showcase[2] && (
            <HeroImage p={showcase[2]} className="absolute bottom-10 right-44 h-[260px] w-[190px] rotate-[1deg]" />
          )}
          <div className="s-card absolute left-0 top-12 w-60 p-4 shadow-2xl backdrop-blur">
            <p className="flex items-center gap-2 text-xs font-semibold">
              <Sparkles className="h-4 w-4 text-[#c4b5fd]" /> <span className="s-ai-text">Provador virtual</span>
            </p>
            <p className="mt-2 text-xs leading-relaxed s-muted">
              Envie uma foto de corpo inteiro e a IA veste você com as peças escolhidas.
            </p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#22d3ee]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroImage({ p, className }: { p: StoreProduct; className: string }) {
  return (
    <div className={`overflow-hidden rounded-[24px] border border-[color:var(--s-line-strong)] shadow-2xl ${className}`}>
      <img src={p.image_url} alt={displayName(p.name)} className="h-full w-full object-cover" />
    </div>
  );
}

function FittingRoomBanner() {
  return (
    <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6">
      <div className="relative overflow-hidden rounded-[28px] border border-[color:var(--s-line)] bg-[color:var(--s-surface)] px-6 py-14 sm:px-12">
        <div className="s-gridlines pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#8b5cf6]/25 blur-3xl"
          aria-hidden
        />
        <div className="relative max-w-2xl">
          <p className="s-eyebrow flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[#c4b5fd]" /> Tecnologia JMK
          </p>
          <h2 className="s-display mt-4 text-4xl sm:text-5xl">Na dúvida entre duas peças? Prove as duas.</h2>
          <p className="mt-4 s-muted">
            Combine a parte de cima com a parte de baixo, ou escolha um vestido, e veja o look pronto em você em
            segundos. Sua foto não fica guardada.
          </p>
          <Link to="/loja/provador" className="s-btn s-btn-ai mt-8">
            <Sparkles /> Abrir o provador
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * O que a vitrine mostra na busca.
 *
 * A raiz do domínio e /loja desenham a mesma página — então as duas apontam o
 * canonical para a raiz, senão o Google trata como duas páginas iguais e
 * divide entre elas o crédito de uma só. A aba de um tipo ("Saias") é outra
 * coisa: é a página que responde a "saia feminina em Osasco", e fica com
 * canonical próprio. Busca digitada e filtro de oferta não entram no canonical
 * — é a mesma lista, filtrada.
 *
 * Os títulos não reaproveitam GARMENT_PLURAL: aquele é rótulo de aba
 * ("Blusas & Camisas") e vira um título torto na busca.
 */
const TITULO_DO_TIPO: Record<GarmentType, string> = {
  blusa: "Blusas e camisas femininas",
  saia: "Saias femininas",
  calca: "Calças femininas",
  vestido: "Vestidos femininos",
  conjunto: "Conjuntos femininos",
  outro: "Peças femininas",
};

function seoDaVitrine(tipo: GarmentType | null, quantas: number) {
  if (!tipo) {
    return {
      title: "JMK Modas — Moda feminina em Osasco com provador de IA",
      description:
        "Vestidos, saias, blusas e conjuntos em Osasco, quase tudo peça única. Prove a roupa em você pelo provador de inteligência artificial e retire na Rua Manoel Cardoso, 20.",
      path: "/",
    };
  }
  const nome = TITULO_DO_TIPO[tipo];
  const quantidade = quantas ? `${quantas} ${quantas === 1 ? "peça disponível" : "peças disponíveis"} hoje. ` : "";
  return {
    title: `${nome} em Osasco`,
    description:
      `${nome} na JMK Modas, na Rua Manoel Cardoso, 20, em Osasco. ${quantidade}` +
      "Prove em você pelo provador de inteligência artificial antes de ir à loja.",
    path: `/loja?tipo=${tipo}`,
  };
}
