import { useEffect } from "react";

/**
 * Título, descrição e marcação de cada página, sem biblioteca.
 *
 * A loja é uma SPA: o HTML que sai do servidor é sempre o mesmo index.html.
 * O Google executa o JavaScript antes de indexar, então o que este hook
 * escreve no <head> depois que a página monta é o que ele lê. O WhatsApp e o
 * Facebook **não** executam — para eles vale só o index.html, e as páginas de
 * peça ganham um HTML próprio no build (vite-plugin-seo.ts).
 *
 * Por isso as tags são escritas por efeito e desfeitas ao sair da página: sem
 * isso o título de uma peça ficaria pendurado na próxima.
 */

export const SITE = "https://www.jmkmodas.com.br";
export const OG_PADRAO = `${SITE}/og-jmk-modas.jpg`;

/** A frase da loja, usada quando a página não traz uma própria. Sem ela, a
 *  descrição da página anterior ficava pendurada na seguinte. */
export const DESCRICAO_PADRAO =
  "Loja de moda feminina em Osasco: vestidos, saias, blusas e conjuntos, quase tudo peça única. " +
  "Prove a roupa em você pelo provador de inteligência artificial.";

export interface Seo {
  /** Já entra na aba como está; some o sufixo da marca se o título já tiver. */
  title: string;
  description?: string;
  /** Caminho absoluto no site, começando com "/". */
  path?: string;
  image?: string;
  type?: "website" | "product" | "article";
  /** Fora da busca: carrinho, pedido, provador em uso, administrativo. */
  noindex?: boolean;
  /** Dados estruturados da página (Product, BreadcrumbList...). */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

const MARCA = "JMK Modas";
const marcado = (t: string) => (t.includes(MARCA) ? t : `${t} — ${MARCA}`);

/** Cria a tag se ela não existir, e marca como nossa para poder limpar depois. */
function setMeta(seletor: string, attr: "name" | "property", chave: string, valor: string) {
  let el = document.head.querySelector<HTMLMetaElement>(seletor);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, chave);
    el.dataset.seo = "pagina";
    document.head.appendChild(el);
  }
  el.setAttribute("content", valor);
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    el.dataset.seo = "pagina";
    document.head.appendChild(el);
  }
  el.href = href;
}

export function useSeo(seo: Seo | null) {
  // A dependência é o conteúdo, não o objeto: a página monta o Seo inline a
  // cada render e um objeto novo reexecutaria o efeito sem necessidade.
  const chave = JSON.stringify(seo);

  useEffect(() => {
    if (!seo) return;
    const anterior = document.title;

    const url = `${SITE}${seo.path ?? "/"}`;
    const titulo = marcado(seo.title);
    const descricao = seo.description?.trim() || DESCRICAO_PADRAO;
    const imagem = seo.image ?? OG_PADRAO;

    document.title = titulo;
    setLink("canonical", url);
    setMeta('meta[property="og:url"]', "property", "og:url", url);
    setMeta('meta[property="og:title"]', "property", "og:title", titulo);
    setMeta('meta[property="og:type"]', "property", "og:type", seo.type ?? "website");
    setMeta('meta[property="og:image"]', "property", "og:image", imagem);
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", titulo);
    setMeta('meta[name="twitter:image"]', "name", "twitter:image", imagem);

    setMeta('meta[name="description"]', "name", "description", descricao);
    setMeta('meta[property="og:description"]', "property", "og:description", descricao);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", descricao);

    setMeta(
      'meta[name="robots"]',
      "name",
      "robots",
      seo.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1",
    );

    // JSON-LD da página. O do index.html (a loja e o site) fica: identifica-se
    // por data-jmk e não é tocado aqui.
    const scripts: HTMLScriptElement[] = [];
    const blocos = seo.jsonLd ? (Array.isArray(seo.jsonLd) ? seo.jsonLd : [seo.jsonLd]) : [];
    for (const bloco of blocos) {
      const s = document.createElement("script");
      s.type = "application/ld+json";
      s.dataset.seo = "pagina";
      s.textContent = JSON.stringify(bloco);
      document.head.appendChild(s);
      scripts.push(s);
    }

    return () => {
      document.title = anterior;
      for (const s of scripts) s.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
}
