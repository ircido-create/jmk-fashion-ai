import { Suspense, useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Loader2, LogIn, MessageCircle, ShoppingBag, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { StoreProvider, useStore } from "./StoreContext";
import { onlyDigits } from "./types";
import "./store.css";

const NAV = [
  { label: "Novidades", to: "/loja" },
  { label: "Vestidos", to: "/loja?tipo=vestido" },
  { label: "Saias", to: "/loja?tipo=saia" },
  { label: "Blusas", to: "/loja?tipo=blusa" },
  { label: "Conjuntos", to: "/loja?tipo=conjunto" },
];

/** Casca da loja: tema, cabeçalho, rodapé e o estado compartilhado (sacola, look, catálogo). */
export default function StoreLayout() {
  return (
    <StoreProvider>
      <StoreShell />
    </StoreProvider>
  );
}

function StoreShell() {
  const { user } = useAuth();
  const { cartCount, settings } = useStore();
  const location = useLocation();

  useEffect(() => {
    document.title = "JMK Modas — Loja virtual";
  }, []);

  // SPA não volta ao topo sozinha ao trocar de página.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const isActive = (to: string) => {
    const [path, query] = to.split("?");
    if (location.pathname !== path) return false;
    return (query ?? "") === location.search.replace(/^\?/, "");
  };

  const whatsapp = settings?.whatsapp ? onlyDigits(settings.whatsapp) : "";

  return (
    <div className="store-scope store-root flex flex-col">
      <a
        href="#loja-conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 s-btn s-btn-gold"
      >
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-40 s-glass">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link to="/loja" className="flex shrink-0 items-baseline gap-2" aria-label="JMK Modas — início">
            <span className="s-display text-[28px] tracking-[0.2em] s-gold">JMK</span>
            <span className="s-eyebrow hidden !tracking-[0.42em] sm:inline">Modas</span>
          </Link>

          <nav aria-label="Coleção" className="ml-8 hidden items-center gap-7 text-sm md:flex">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                aria-current={isActive(n.to) ? "page" : undefined}
                className={`s-link ${isActive(n.to) ? "s-gold" : "s-muted"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            {/* !hidden: o display do .s-btn tem mais especificidade que o utilitário
                e o botão aparecia no celular, duplicando o atalho da faixa abaixo. */}
            <NavLink to="/loja/provador" className="s-btn s-btn-ai !h-9 !px-4 !text-xs !hidden sm:!inline-flex">
              <Sparkles /> Provador IA
            </NavLink>

            <Link
              to="/loja/carrinho"
              className="s-icon-btn relative"
              aria-label={`Sacola, ${cartCount} ${cartCount === 1 ? "peça" : "peças"}`}
            >
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[color:var(--s-gold)] px-1 text-[10px] font-bold text-[#17130c]">
                  {cartCount}
                </span>
              )}
            </Link>

            {/* Acesso ao administrativo: mesma origem, mesma sessão. */}
            {user ? (
              <Link to="/" className="s-btn s-btn-ghost !h-9 !px-3 !text-xs" title="Ir para o sistema administrativo">
                <LayoutDashboard /> <span className="hidden sm:inline">Painel</span>
              </Link>
            ) : (
              <Link to="/auth" className="s-btn s-btn-ghost !h-9 !px-3 !text-xs" title="Acesso da equipe JMK">
                <LogIn /> <span className="hidden sm:inline">Entrar</span>
              </Link>
            )}
          </div>
        </div>

        <nav aria-label="Coleção" className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
          <Link to="/loja/provador" className="s-chip !border-[color:var(--s-violet)]">
            <Sparkles className="h-3.5 w-3.5 text-[#c4b5fd]" /> Provador IA
          </Link>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="s-chip" data-active={isActive(n.to)}>
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="loja-conteudo" className="flex-1">
        <Suspense
          fallback={
            <div className="grid place-items-center py-40">
              <Loader2 className="h-6 w-6 animate-spin s-gold" aria-label="Carregando" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      <footer className="mt-24 border-t s-divider">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="s-display text-3xl tracking-[0.2em] s-gold">JMK</span>
              <span className="s-eyebrow !tracking-[0.42em]">Modas</span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed s-muted">
              Moda feminina com elegância. Escolha, monte o look e veja em você com o nosso provador de
              inteligência artificial.
            </p>
          </div>

          <div>
            <p className="s-eyebrow">Loja</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><Link to="/loja" className="s-link s-muted">Coleção</Link></li>
              <li><Link to="/loja/provador" className="s-link s-muted">Provador IA</Link></li>
              <li><Link to="/loja/carrinho" className="s-link s-muted">Minha sacola</Link></li>
            </ul>
          </div>

          <div>
            <p className="s-eyebrow">Atendimento</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {whatsapp && (
                <li>
                  <a
                    href={`https://wa.me/${whatsapp}`}
                    target="_blank"
                    rel="noreferrer"
                    className="s-link s-muted inline-flex items-center gap-2"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                </li>
              )}
              {settings?.pickup_address && <li className="s-muted">{settings.pickup_address}</li>}
              <li>
                <Link to="/auth" className="s-link s-muted inline-flex items-center gap-2">
                  <LogIn className="h-4 w-4" /> Área da equipe
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t s-divider">
          <p className="mx-auto max-w-7xl px-4 py-6 text-xs s-muted sm:px-6">
            © {new Date().getFullYear()} JMK Modas · As fotos enviadas ao provador são usadas só para gerar a prova e
            não ficam guardadas.
          </p>
        </div>
      </footer>
    </div>
  );
}
