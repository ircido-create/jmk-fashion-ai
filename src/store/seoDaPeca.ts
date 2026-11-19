import { displayName, offerOf, type StoreProduct } from "./types";

/**
 * Título, descrição e dados estruturados de uma peça.
 *
 * Fica fora da página porque o build precisa do mesmo texto: o
 * vite-plugin-seo.ts escreve um HTML por peça para o WhatsApp e o Facebook,
 * que não executam JavaScript, e a página escreve o mesmo no navegador para o
 * Google. Se os dois divergirem, o Google vê uma coisa e a cliente recebe
 * outra no link.
 *
 * Só importa de ./types, e de lá só valores simples — este arquivo roda
 * também no Node, durante o build, onde não existe React nem o alias "@".
 */

export const SITE = "https://www.jmkmodas.com.br";
export const LOJA_ID = `${SITE}/#loja`;

const TIPO_LEGIVEL: Record<string, string> = {
  blusa: "Blusa",
  saia: "Saia",
  calca: "Calça",
  vestido: "Vestido",
  conjunto: "Conjunto",
};

/** "Vestido feminino", mas "Saia feminina" — o título fica torto sem isto. */
const FEMININO: Record<string, boolean> = { blusa: true, saia: true, calca: true };

/**
 * Ordem da grade, do menor para o maior.
 *
 * O banco devolve as variações na ordem em que foram cadastradas, e a lista
 * saía alfabética ("G, GG, M, P, PP"), que é como ninguém fala de tamanho.
 * Numeração (36, 38, 40) entra depois das letras, em ordem de número.
 * "Único" vai para o fim: não é um degrau da grade, é a ausência dela.
 */
const ORDEM_DOS_TAMANHOS = ["pp", "p", "m", "g", "gg", "gg+", "xg", "xgg", "exg"];

/**
 * A mesma escrita para o mesmo tamanho. O cadastro vem dos romaneios, onde o
 * mesmo tamanho aparece como "M", "m" e " M " — sem isto o filtro da vitrine
 * mostraria o mesmo tamanho duas vezes em chips separados.
 */
export const chaveDoTamanho = (t: string) =>
  t.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");

/** Como o tamanho aparece para a cliente: "M", "42", "Único". */
export const rotuloDoTamanho = (t: string) =>
  chaveDoTamanho(t) === "unico" ? "Único" : t.trim().toLocaleUpperCase("pt-BR");

export function ordenarTamanhos(ts: string[]): string[] {
  const peso = (t: string) => {
    const chave = chaveDoTamanho(t);
    const i = ORDEM_DOS_TAMANHOS.indexOf(chave);
    if (i >= 0) return i;
    if (chave === "unico") return 2000;
    const n = Number(chave.replace(",", "."));
    return Number.isFinite(n) ? 100 + n : 1000;
  };
  return [...ts].sort((a, b) => peso(a) - peso(b) || a.localeCompare(b, "pt-BR"));
}

export const caminhoDaPeca = (id: string) => `/loja/produto/${id}`;

/** Tamanhos e cores com peça em estoque, sem repetir. */
export function gradeDaPeca(p: StoreProduct) {
  const vivas = (p.variants ?? []).filter((v) => (v.quantity ?? 0) > 0);
  const tamanhos = ordenarTamanhos([...new Set(vivas.map((v) => v.size).filter(Boolean) as string[])]);
  const cores = [...new Set(vivas.map((v) => v.color).filter(Boolean) as string[])];
  const emEstoque = vivas.length > 0 || (p.variants ?? []).length === 0;
  return { tamanhos, cores, emEstoque };
}

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/**
 * A frase que aparece embaixo do link no Google e no WhatsApp.
 *
 * A maior parte do catálogo ainda está sem descrição escrita — nesses casos a
 * frase é montada com o que o cadastro tem de verdade (tipo, preço, desconto,
 * tamanhos e cores). É melhor do que repetir a descrição da loja em todas as
 * peças, que é o que o Google trata como página sem conteúdo próprio.
 */
export function descricaoDaPeca(p: StoreProduct): string {
  const nome = displayName(p.name);
  const oferta = offerOf(p);
  const { tamanhos, cores, emEstoque } = gradeDaPeca(p);

  const partes: string[] = [];
  const propria = (p.description ?? "").trim();
  if (propria) partes.push(propria.replace(/\s+/g, " "));

  partes.push(
    oferta
      ? `${nome} de ${dinheiro(oferta.de)} por ${dinheiro(p.price)} (${oferta.off}% de desconto).`
      : `${nome} por ${dinheiro(p.price)}.`,
  );

  if (tamanhos.length) partes.push(`Tamanho${tamanhos.length > 1 ? "s" : ""} ${tamanhos.join(", ")}.`);
  if (cores.length) partes.push(`${cores.length > 1 ? "Cores" : "Cor"} ${cores.join(", ").toLocaleLowerCase("pt-BR")}.`);
  if (!emEstoque) partes.push("Peça esgotada.");

  // O Google corta perto de 160 caracteres. A cauda da loja é o que menos
  // importa, então ela só entra se couber inteira — melhor terminar numa frase
  // completa do que exibir "Prove em…".
  const LIMITE = 160;
  const corpo = partes.join(" ");
  const cauda = "JMK Modas, Osasco. Prove em você pelo provador de IA.";
  if (corpo.length + 1 + cauda.length <= LIMITE) return `${corpo} ${cauda}`;
  if (corpo.length <= LIMITE) return corpo;
  const corte = corpo.slice(0, LIMITE - 1);
  return corte.slice(0, corte.lastIndexOf(" ")) + "…";
}

export function tituloDaPeca(p: StoreProduct): string {
  const nome = displayName(p.name);
  const tipo = p.garment_type ? TIPO_LEGIVEL[p.garment_type] : null;
  // "Vestido Carmem" já diz o tipo; "Carmem" sozinho, não.
  const base =
    tipo && !nome.toLocaleLowerCase("pt-BR").includes(tipo.toLocaleLowerCase("pt-BR"))
      ? `${nome} — ${tipo} ${FEMININO[p.garment_type as string] ? "feminina" : "feminino"}`
      : nome;
  return `${base} | JMK Modas Osasco`;
}

/**
 * Product do schema.org: é o que faz o Google mostrar preço e "em estoque"
 * junto do link, em vez de só o título.
 */
export function jsonLdDaPeca(p: StoreProduct): Record<string, unknown> {
  const url = `${SITE}${caminhoDaPeca(p.id)}`;
  const { tamanhos, cores, emEstoque } = gradeDaPeca(p);
  const fotos = [...new Set([p.image_url, ...(p.images ?? [])].filter(Boolean))] as string[];

  const bloco: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#peca`,
    name: displayName(p.name),
    description: descricaoDaPeca(p),
    url,
    image: fotos,
    brand: { "@type": "Brand", name: "JMK Modas" },
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "BRL",
      price: p.price.toFixed(2),
      availability: emEstoque
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@id": LOJA_ID },
    },
  };

  if (tamanhos.length) bloco.size = tamanhos;
  if (cores.length) bloco.color = cores.join(", ");
  if (p.garment_type) bloco.category = TIPO_LEGIVEL[p.garment_type] ?? p.garment_type;
  return bloco;
}

/** Caminho de migalhas: ajuda o Google a entender coleção → tipo → peça. */
export function breadcrumbDaPeca(p: StoreProduct): Record<string, unknown> {
  const itens: { name: string; item: string }[] = [{ name: "Coleção", item: `${SITE}/` }];
  if (p.garment_type) {
    itens.push({
      name: TIPO_LEGIVEL[p.garment_type] ?? p.garment_type,
      item: `${SITE}/loja?tipo=${p.garment_type}`,
    });
  }
  itens.push({ name: displayName(p.name), item: `${SITE}${caminhoDaPeca(p.id)}` });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: itens.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.item,
    })),
  };
}
