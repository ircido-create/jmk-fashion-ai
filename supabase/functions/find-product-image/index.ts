import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL = "https://api.firecrawl.dev/v2";

interface FindRequest {
  product_name: string;
  supplier?: string;
  domain_override?: string;
}

interface SaveRequest {
  image_url: string;
  product_id?: string;
  variant_id?: string;
  apply_to_all_variants?: boolean;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

async function fcSearch(query: string, fcKey: string, limit = 5) {
  const res = await fetch(`${FIRECRAWL}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl search ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function fcScrape(url: string, fcKey: string) {
  const res = await fetch(`${FIRECRAWL}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["html", "links", "markdown"],
      onlyMainContent: false,
      waitFor: 1500,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl scrape ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

function extractImagesFromHtml(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  // og:image
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) out.add(og[1]);
  // twitter:image
  const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (tw?.[1]) out.add(tw[1]);
  // <img src=...>
  const imgRe = /<img[^>]+(?:src|data-src|data-original|data-lazy)=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    let src = m[1];
    if (!src) continue;
    if (src.startsWith("//")) src = "https:" + src;
    if (src.startsWith("/")) {
      try {
        src = new URL(src, baseUrl).toString();
      } catch {}
    }
    if (!/^https?:\/\//i.test(src)) continue;
    if (/\.(svg|gif)(\?|$)/i.test(src)) continue;
    if (/(logo|icon|favicon|sprite|placeholder|spinner|loader)/i.test(src)) continue;
    out.add(src);
  }
  return Array.from(out).slice(0, 30);
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return og[1];
  const t = html.match(/<title>([^<]+)<\/title>/i);
  return t?.[1] ?? "";
}

async function handleFind(req: FindRequest, fcKey: string, supabase: any) {
  const { product_name, supplier } = req;
  if (!product_name) throw new Error("product_name é obrigatório");

  // Resolve domain
  let domain = req.domain_override?.trim() || "";
  if (!domain && supplier) {
    const { data } = await supabase
      .from("supplier_sites")
      .select("domain")
      .ilike("supplier_name", supplier)
      .maybeSingle();
    if (data?.domain) domain = data.domain;
  }

  // Build search query
  const candidates: { url: string; title: string; score: number }[] = [];

  if (domain) {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const search = await fcSearch(`site:${cleanDomain} ${product_name}`, fcKey, 5);
    const results = search?.data?.web ?? search?.data ?? [];
    for (const r of results) {
      if (r?.url) candidates.push({ url: r.url, title: r.title || "", score: 0 });
    }
  } else if (supplier) {
    const search = await fcSearch(`${supplier} ${product_name} comprar`, fcKey, 5);
    const results = search?.data?.web ?? search?.data ?? [];
    for (const r of results) {
      if (r?.url) candidates.push({ url: r.url, title: r.title || "", score: 0 });
    }
  } else {
    const search = await fcSearch(`${product_name} loja`, fcKey, 5);
    const results = search?.data?.web ?? search?.data ?? [];
    for (const r of results) {
      if (r?.url) candidates.push({ url: r.url, title: r.title || "", score: 0 });
    }
  }

  if (candidates.length === 0) {
    return { images: [], message: "Nenhum resultado encontrado para esse produto" };
  }

  // Score by title similarity, take top 3 to scrape
  for (const c of candidates) c.score = similarity(product_name, c.title);
  candidates.sort((a, b) => b.score - a.score);
  const topPages = candidates.slice(0, 3);

  // Scrape pages in parallel
  const scraped = await Promise.allSettled(topPages.map((p) => fcScrape(p.url, fcKey)));

  const allImages: { url: string; score: number; source: string; title: string }[] = [];
  for (let i = 0; i < scraped.length; i++) {
    const result = scraped[i];
    const page = topPages[i];
    if (result.status !== "fulfilled") continue;
    const data = result.value?.data ?? result.value;
    const html = data?.html ?? "";
    if (!html) continue;
    const pageTitle = extractTitle(html) || page.title;
    const titleScore = similarity(product_name, pageTitle);
    const imgs = extractImagesFromHtml(html, page.url);
    for (const img of imgs.slice(0, 8)) {
      allImages.push({ url: img, score: titleScore, source: page.url, title: pageTitle });
    }
  }

  // Dedupe by URL, prefer higher score
  const seen = new Map<string, typeof allImages[0]>();
  for (const img of allImages) {
    const existing = seen.get(img.url);
    if (!existing || existing.score < img.score) seen.set(img.url, img);
  }

  const final = Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return { images: final, candidates: topPages };
}

async function handleSave(req: SaveRequest, supabase: any) {
  const { image_url, product_id, variant_id, apply_to_all_variants } = req;
  if (!image_url) throw new Error("image_url é obrigatório");

  // Download image server-side
  const imgRes = await fetch(image_url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Lovable/1.0)" },
  });
  if (!imgRes.ok) throw new Error(`Falha ao baixar imagem: ${imgRes.status}`);
  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("URL não é uma imagem");
  const buffer = await imgRes.arrayBuffer();
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("Imagem maior que 8MB");

  const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
  const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("product-images")
    .upload(path, new Uint8Array(buffer), { contentType, upsert: false });
  if (upErr) throw new Error(`Upload falhou: ${upErr.message}`);

  const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  // Persist
  if (variant_id) {
    const { error } = await supabase
      .from("product_variants")
      .update({ image_url: publicUrl })
      .eq("id", variant_id);
    if (error) throw new Error(error.message);
  }
  if (product_id) {
    const updates: Promise<any>[] = [
      supabase.from("products").update({ image_url: publicUrl }).eq("id", product_id),
    ];
    if (apply_to_all_variants) {
      updates.push(
        supabase
          .from("product_variants")
          .update({ image_url: publicUrl })
          .eq("product_id", product_id),
      );
    }
    const results = await Promise.all(updates);
    for (const r of results) if (r.error) throw new Error(r.error.message);
  }

  return { image_url: publicUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const fcKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!fcKey) throw new Error("FIRECRAWL_API_KEY não configurada");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const action = body?.action || "find";

    let result;
    if (action === "find") {
      result = await handleFind(body as FindRequest, fcKey, supabase);
    } else if (action === "save") {
      result = await handleSave(body as SaveRequest, supabase);
    } else {
      throw new Error(`Ação desconhecida: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("find-product-image error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
