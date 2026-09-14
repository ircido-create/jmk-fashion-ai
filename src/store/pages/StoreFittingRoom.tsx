import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, Download, ImagePlus, Loader2, RotateCcw, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtBRL } from "@/lib/utils";
import { REGION_LABEL, regionOf, type BodyRegion } from "@/lib/garments";
import { useStore } from "../StoreContext";
import { downscalePhoto, tryOn } from "../api";
import { displayName, type StoreProduct } from "../types";

const REGIONS: BodyRegion[] = ["upper", "lower", "full"];
const MAX_RAW_PHOTO = 20 * 1024 * 1024;

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export default function StoreFittingRoom() {
  const { catalog, productById, loading, look, setLookPiece, removeLookPiece } = useStore();
  const [photo, setPhoto] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<BodyRegion | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const pieces = REGIONS.map((region) => ({
    region,
    product: look[region] ? productById.get(look[region]!) : undefined,
  }));
  const chosen = pieces.filter((p) => p.product) as { region: BodyRegion; product: StoreProduct }[];
  const hasFull = !!look.full;
  const hasPart = !!look.upper || !!look.lower;
  const canRun = !!photo && consent && chosen.length > 0 && !busy;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Escolha uma imagem (foto).");
      return;
    }
    if (file.size > MAX_RAW_PHOTO) {
      setError("Essa foto é grande demais. Tente outra.");
      return;
    }
    setPreparing(true);
    try {
      setPhoto(await downscalePhoto(file));
      setResult(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  };

  const run = async () => {
    if (!canRun || !photo) return;
    setBusy(true);
    setError(null);
    setResult(null);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      setResult(await tryOn(photo, chosen.map((c) => c.product.id)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
      <header className="max-w-3xl s-fade-up">
        <p className="s-eyebrow flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-[#c4b5fd]" /> Provador virtual · Inteligência artificial
        </p>
        <h1 className="s-display mt-4 text-5xl sm:text-6xl">
          Veja o look <span className="s-ai-text">em você</span> antes de levar.
        </h1>
        <p className="mt-5 text-base leading-relaxed s-muted sm:text-lg">
          Envie uma foto de corpo inteiro, escolha as peças — uma blusa com uma saia, ou um vestido, ou um conjunto —
          e a IA troca a sua roupa pelas peças da coleção.
        </p>
      </header>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* 1. foto */}
        <section className="s-card p-6 sm:p-8" aria-labelledby="passo-foto">
          <h2 id="passo-foto" className="flex items-center gap-3 text-lg font-semibold">
            <Step n={1} /> Sua foto
          </h2>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {photo ? (
            <div className="mt-6">
              <div className="relative mx-auto aspect-[3/4] max-h-[460px] overflow-hidden rounded-2xl border border-[color:var(--s-line)] bg-black/30">
                <img src={photo} alt="Sua foto" className="h-full w-full object-contain" />
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button type="button" className="s-btn s-btn-ghost !h-10" onClick={() => fileRef.current?.click()}>
                  <RotateCcw /> Trocar foto
                </button>
                <button
                  type="button"
                  className="s-btn s-btn-ghost !h-10"
                  onClick={() => { setPhoto(null); setResult(null); }}
                >
                  <X /> Remover
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={preparing}
              className="mt-6 flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[color:var(--s-line-strong)] bg-white/[0.02] text-center transition hover:border-[color:var(--s-gold)]"
            >
              {preparing ? (
                <Loader2 className="h-8 w-8 animate-spin s-gold" />
              ) : (
                <ImagePlus className="h-8 w-8 s-gold" />
              )}
              <span className="font-medium">{preparing ? "Preparando a foto…" : "Enviar foto de corpo inteiro"}</span>
              <span className="text-xs s-muted">Tire agora com a câmera ou escolha da galeria</span>
            </button>
          )}

          <ul className="mt-6 grid gap-2 text-sm s-muted sm:grid-cols-2">
            <li className="flex gap-2"><Camera className="mt-0.5 h-4 w-4 shrink-0 s-gold" /> De frente, do rosto aos pés</li>
            <li className="flex gap-2"><Camera className="mt-0.5 h-4 w-4 shrink-0 s-gold" /> Boa luz, fundo simples</li>
            <li className="flex gap-2"><Camera className="mt-0.5 h-4 w-4 shrink-0 s-gold" /> Braços ao lado do corpo</li>
            <li className="flex gap-2"><Camera className="mt-0.5 h-4 w-4 shrink-0 s-gold" /> Só você na foto</li>
          </ul>

          <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#d8bd8a]"
            />
            <span className="s-muted">
              A foto é minha (ou tenho autorização da pessoa) e concordo que ela seja usada só para gerar esta prova.
            </span>
          </label>
          <p className="mt-3 flex items-center gap-2 text-xs s-muted">
            <ShieldCheck className="h-4 w-4 s-gold" /> Sua foto não fica guardada: é descartada logo após a prova.
          </p>
        </section>

        {/* 2. look */}
        <section className="s-card p-6 sm:p-8" aria-labelledby="passo-look">
          <h2 id="passo-look" className="flex items-center gap-3 text-lg font-semibold">
            <Step n={2} /> Seu look
          </h2>
          <p className="mt-2 text-sm s-muted">
            Combine uma parte de cima com uma parte de baixo, ou escolha um vestido ou conjunto.
          </p>

          <div className="mt-6 space-y-3">
            {pieces.map(({ region, product }) => {
              const blocked = (region === "full" && hasPart) || (region !== "full" && hasFull);
              return (
                <div
                  key={region}
                  className={`flex items-center gap-4 rounded-2xl border p-3 ${
                    product ? "border-[color:var(--s-gold)]/60 bg-white/[0.03]" : "border-[color:var(--s-line)]"
                  }`}
                >
                  <div className="grid h-20 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-[color:var(--s-surface-2)]">
                    {product ? (
                      <img src={product.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Sparkles className="h-5 w-5 s-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="s-eyebrow !text-[10px]">{REGION_LABEL[region]}</p>
                    {product ? (
                      <>
                        <p className="mt-1 truncate text-sm font-medium">{displayName(product.name)}</p>
                        <p className="text-xs tabular-nums s-gold">{fmtBRL(product.price)}</p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm s-muted">
                        {blocked
                          ? region === "full"
                            ? "Substitui a parte de cima e de baixo"
                            : "Não se usa com vestido ou conjunto"
                          : "Nenhuma peça escolhida"}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className="s-btn s-btn-ghost !h-9 !px-3 !text-xs" onClick={() => setPicker(region)}>
                      {product ? "Trocar" : "Escolher"}
                    </button>
                    {product && (
                      <button
                        type="button"
                        className="s-icon-btn"
                        onClick={() => removeLookPiece(region)}
                        aria-label={`Remover ${REGION_LABEL[region].toLowerCase()}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button type="button" className="s-btn s-btn-ai mt-8 w-full !h-14 !text-base" onClick={run} disabled={!canRun}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? "Vestindo você…" : "Experimentar agora"}
          </button>
          {!canRun && !busy && (
            <p className="mt-3 text-center text-xs s-muted">
              {!photo
                ? "Envie sua foto para começar."
                : chosen.length === 0
                ? "Escolha pelo menos uma peça."
                : !consent
                ? "Confirme o uso da foto para continuar."
                : ""}
            </p>
          )}
        </section>
      </div>

      {/* resultado */}
      <div ref={resultRef} className="scroll-mt-24">
        {error && (
          <div role="alert" className="mt-8 rounded-2xl border border-red-400/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {(busy || result) && photo && (
          <section className="s-card mt-8 p-6 sm:p-8" aria-live="polite">
            <h2 className="flex items-center gap-3 text-lg font-semibold">
              <Step n={3} /> {busy ? "A IA está montando o seu look" : "Seu look"}
            </h2>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <figure>
                <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-[color:var(--s-line)] bg-black/30">
                  <img src={photo} alt="Antes" className={`h-full w-full object-contain ${busy ? "opacity-60" : ""}`} />
                  {busy && <div className="s-scanline" aria-hidden />}
                </div>
                <figcaption className="s-eyebrow mt-3 text-center">Antes</figcaption>
              </figure>
              <figure>
                <div className="relative grid aspect-[3/4] place-items-center overflow-hidden rounded-2xl border border-[color:var(--s-violet)]/50 bg-black/30">
                  {result ? (
                    <img src={result} alt="Você com o look escolhido" className="h-full w-full object-contain s-fade-up" />
                  ) : (
                    <div className="px-6 text-center">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#c4b5fd]" />
                      <p className="mt-4 text-sm s-muted">Isso costuma levar de 20 a 40 segundos.</p>
                    </div>
                  )}
                </div>
                <figcaption className="s-eyebrow mt-3 text-center">
                  <span className="s-ai-text">Com o look</span>
                </figcaption>
              </figure>
            </div>

            {result && (
              <>
                <p className="mt-6 text-xs s-muted">
                  Imagem gerada por IA, para você ter uma ideia do caimento. Cores e medidas podem variar um pouco da peça real.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a href={result} download="meu-look-jmk.png" className="s-btn s-btn-ghost">
                    <Download /> Salvar imagem
                  </a>
                  <button type="button" className="s-btn s-btn-ghost" onClick={() => setResult(null)}>
                    <RotateCcw /> Nova prova
                  </button>
                </div>
                <div className="mt-8 border-t pt-6 s-divider">
                  <p className="s-eyebrow">Gostou? Escolha o tamanho de cada peça</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {chosen.map(({ product }) => (
                      <Link key={product.id} to={`/loja/produto/${product.id}`} className="s-btn s-btn-gold">
                        {displayName(product.name)}
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      <PiecePicker
        region={picker}
        catalog={catalog}
        loading={loading}
        selectedId={picker ? look[picker] : undefined}
        onClose={() => setPicker(null)}
        onPick={(p) => {
          setLookPiece(p);
          setPicker(null);
          setResult(null);
        }}
      />
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full border border-[color:var(--s-gold)]/60 text-sm font-semibold s-gold">
      {n}
    </span>
  );
}

function PiecePicker({
  region, catalog, loading, selectedId, onClose, onPick,
}: {
  region: BodyRegion | null;
  catalog: StoreProduct[];
  loading: boolean;
  selectedId?: string;
  onClose: () => void;
  onPick: (p: StoreProduct) => void;
}) {
  const [q, setQ] = useState("");
  const options = useMemo(() => {
    if (!region) return [];
    const term = normalize(q.trim());
    return catalog.filter(
      (p) => regionOf(p.garment_type) === region && (!term || normalize(p.name).includes(term)),
    );
  }, [catalog, region, q]);

  return (
    <Dialog open={!!region} onOpenChange={(o) => { if (!o) { onClose(); setQ(""); } }}>
      <DialogContent className="store-scope max-h-[88vh] max-w-3xl overflow-y-auto border-[color:var(--s-line-strong)] bg-[#131318] text-[#f4f1ec] sm:rounded-[24px]">
        <DialogHeader>
          <DialogTitle className="s-display text-3xl font-medium">
            {region ? REGION_LABEL[region] : ""}
          </DialogTitle>
        </DialogHeader>
        <label className="relative block">
          <span className="sr-only">Buscar</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 s-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar peças" className="s-input !pl-11" />
        </label>
        {loading ? (
          <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin s-gold" /></div>
        ) : options.length === 0 ? (
          <p className="py-12 text-center text-sm s-muted">Nenhuma peça desse tipo disponível no provador agora.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {options.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p)}
                aria-pressed={selectedId === p.id}
                className={`group overflow-hidden rounded-2xl border text-left transition ${
                  selectedId === p.id ? "border-[color:var(--s-gold)]" : "border-[color:var(--s-line)] hover:border-[color:var(--s-line-strong)]"
                }`}
              >
                <div className="aspect-[3/4] overflow-hidden bg-[color:var(--s-surface-2)]">
                  <img src={p.image_url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-xs leading-snug">{displayName(p.name)}</p>
                  <p className="mt-1 text-xs font-semibold tabular-nums s-gold">{fmtBRL(p.price)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
