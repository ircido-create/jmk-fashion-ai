import fs from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import {
  SITE,
  breadcrumbDaPeca,
  caminhoDaPeca,
  descricaoDaPeca,
  jsonLdDaPeca,
  tituloDaPeca,
} from "./src/store/seoDaPeca";
import type { StoreProduct } from "./src/store/types";

/**
 * O SEO que só o build consegue fazer.
 *
 * A loja é uma SPA: o servidor devolve sempre o mesmo index.html, sem saber
 * que peça foi pedida. O Google até executa o JavaScript e lê o que o
 * componente <Seo> escreve, mas **o WhatsApp e o Facebook não executam nada** —
 * para eles todo link da loja era a mesma coisa: "JMK Modas — Loja virtual",
 * com o ícone do app no lugar da foto da peça. Quem manda link de peça no
 * WhatsApp o dia inteiro sente isso.
 *
 * Então, no fim do build, este plugin:
 *
 *  1. busca o catálogo público (a mesma função store_catalog que a vitrine usa,
 *     com a chave pública — nada de segredo entra aqui);
 *  2. escreve dist/sitemap.xml com as páginas de verdade, peça por peça;
 *  3. escreve um dist/loja/produto/<id>/index.html por peça, igual ao da loja
 *     mas com o título, a descrição, a foto e o Product do schema.org daquela
 *     peça. O app React monta por cima normalmente — é o mesmo bundle.
 *
 * Se a busca falhar, o build **não** quebra: fica o sitemap que está em
 * public/ e o site sobe igual. SEO não é motivo para derrubar uma publicação.
 */

interface Opcoes {
  supabaseUrl?: string;
  supabaseKey?: string;
}

const TIPOS_NO_SITEMAP = ["vestido", "saia", "blusa", "conjunto", "calca"] as const;

/** Texto dentro de atributo HTML e de XML. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function buscarCatalogo(url: string, key: string): Promise<StoreProduct[]> {
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${url}/rest/v1/rpc/store_catalog`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const dados = (await r.json()) as StoreProduct[];
    return (dados ?? []).map((p) => ({
      ...p,
      price: Number(p.price),
      compare_at_price: p.compare_at_price == null ? null : Number(p.compare_at_price),
      images: Array.isArray(p.images) ? p.images.filter(Boolean) : [],
      variants: Array.isArray(p.variants) ? p.variants : [],
    }));
  } finally {
    clearTimeout(limite);
  }
}

function sitemap(pecas: StoreProduct[], tiposComPeca: string[]): string {
  const hoje = new Date().toISOString().slice(0, 10);
  const url = (loc: string, prioridade: string, freq: string, lastmod?: string) =>
    `  <url>\n    <loc>${esc(loc)}</loc>\n    <lastmod>${lastmod ?? hoje}</lastmod>\n` +
    `    <changefreq>${freq}</changefreq>\n    <priority>${prioridade}</priority>\n  </url>`;

  const linhas = [
    url(`${SITE}/`, "1.0", "daily"),
    url(`${SITE}/loja/provador`, "0.8", "monthly"),
    ...tiposComPeca.map((t) => url(`${SITE}/loja?tipo=${t}`, "0.7", "weekly")),
    ...pecas.map((p) =>
      url(`${SITE}${caminhoDaPeca(p.id)}`, "0.6", "weekly", (p.created_at ?? "").slice(0, 10) || undefined),
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join("\n")}\n</urlset>\n`;
}

/**
 * Troca no <head> o que é específico da peça.
 *
 * Mexe só nas tags que o index.html já traz, por atributo — nada de montar o
 * HTML de novo, para o arquivo seguir idêntico ao que o Vite gerou (mesmos
 * scripts, mesmos hashes).
 */
function headDaPeca(htmlBase: string, p: StoreProduct): string {
  const titulo = tituloDaPeca(p);
  const descricao = descricaoDaPeca(p);
  const url = `${SITE}${caminhoDaPeca(p.id)}`;
  const foto = p.image_url || `${SITE}/og-jmk-modas.jpg`;

  const trocas: [RegExp, string][] = [
    [/<title>[\s\S]*?<\/title>/, `<title>${esc(titulo)}</title>`],
    [/(<meta name="description" content=")[^"]*(")/, `$1${esc(descricao)}$2`],
    [/(<link rel="canonical" href=")[^"]*(")/, `$1${esc(url)}$2`],
    [/(<meta property="og:type" content=")[^"]*(")/, `$1product$2`],
    [/(<meta property="og:url" content=")[^"]*(")/, `$1${esc(url)}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(titulo)}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(descricao)}$2`],
    [/(<meta property="og:image" content=")[^"]*(")/, `$1${esc(foto)}$2`],
    [/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${esc(titulo)}$2`],
    [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(titulo)}$2`],
    [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(descricao)}$2`],
    [/(<meta name="twitter:image" content=")[^"]*(")/, `$1${esc(foto)}$2`],
  ];

  let html = htmlBase;
  for (const [de, para] of trocas) html = html.replace(de, para);

  // A foto da peça não tem 1200x630: as medidas da imagem da loja mentiriam.
  html = html.replace(/\s*<meta property="og:image:(width|height)" content="\d+" \/>/g, "");

  const dados =
    `<script type="application/ld+json">${JSON.stringify(jsonLdDaPeca(p))}</script>` +
    `<script type="application/ld+json">${JSON.stringify(breadcrumbDaPeca(p))}</script>`;
  return html.replace("</head>", `${dados}\n  </head>`);
}

export function seoPlugin(opcoes: Opcoes = {}): Plugin {
  return {
    name: "jmk-seo",
    apply: "build",
    enforce: "post",
    async closeBundle() {
      const url = opcoes.supabaseUrl;
      const key = opcoes.supabaseKey;
      const dist = path.resolve(process.cwd(), "dist");
      const aviso = (m: string) => console.warn(`[jmk-seo] ${m} — o site sobe igual, só sem esta parte.`);

      if (!url || !key) {
        aviso("sem VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY no build");
        return;
      }

      let pecas: StoreProduct[];
      try {
        pecas = await buscarCatalogo(url, key);
      } catch (e) {
        aviso(`não consegui ler o catálogo (${e instanceof Error ? e.message : e})`);
        return;
      }
      if (!pecas.length) {
        aviso("o catálogo voltou vazio");
        return;
      }

      const tipos = TIPOS_NO_SITEMAP.filter((t) => pecas.some((p) => p.garment_type === t));
      await fs.writeFile(path.join(dist, "sitemap.xml"), sitemap(pecas, tipos), "utf8");

      let htmlBase: string;
      try {
        htmlBase = await fs.readFile(path.join(dist, "index.html"), "utf8");
      } catch {
        aviso("não achei o dist/index.html");
        return;
      }

      /**
       * Duas cópias por peça, de propósito.
       *
       * O endereço que a cliente recebe é /loja/produto/<id>, sem barra no fim
       * e sem extensão, e cada hospedagem estática resolve isso de um jeito:
       * umas procuram <id>/index.html, outras <id>.html, e a que não acha nada
       * cai no index.html da loja. Escrever as duas custa um arquivo de texto
       * e cobre os dois comportamentos; se a hospedagem não fizer nenhum dos
       * dois, nada quebra — volta a ser a prévia genérica de antes.
       */
      const base = path.join(dist, "loja", "produto");
      await fs.mkdir(base, { recursive: true });
      let escritas = 0;
      for (const p of pecas) {
        const html = headDaPeca(htmlBase, p);
        await fs.mkdir(path.join(base, p.id), { recursive: true });
        await fs.writeFile(path.join(base, p.id, "index.html"), html, "utf8");
        await fs.writeFile(path.join(base, `${p.id}.html`), html, "utf8");
        escritas++;
      }

      console.log(`[jmk-seo] sitemap com ${pecas.length + tipos.length + 2} endereços e ${escritas} páginas de peça.`);
    },
  };
}
