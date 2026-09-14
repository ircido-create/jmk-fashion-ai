// Provador virtual da loja: veste a foto da cliente com as peças escolhidas.
//
// Função pública (a loja não tem login de cliente), então três cuidados:
// - As peças vêm do banco pelo id. URL e tipo enviados pelo navegador seriam
//   um convite para usar a IA da loja com qualquer imagem da internet.
// - Cada geração consome créditos de IA: há limite por aparelho e por dia.
// - A foto da cliente é processada em memória e descartada. Nada é gravado nem
//   registrado em log — é uma foto de corpo inteiro de uma pessoa.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Nomes mudam entre gerações de modelo no gateway; tenta do mais novo ao mais
// antigo e para no primeiro que responder com imagem.
const MODELS = [
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image-preview",
];

const PER_CLIENT_PER_HOUR = 6;
const GLOBAL_PER_DAY = 150;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MAX_GARMENT_BYTES = 8 * 1024 * 1024;

type Region = "upper" | "lower" | "full";
const REGION: Record<string, Region> = {
  blusa: "upper",
  saia: "lower",
  calca: "lower",
  vestido: "full",
  conjunto: "full",
};
const REGION_EN: Record<Region, string> = {
  upper: "top (upper-body garment)",
  lower: "bottom (lower-body garment)",
  full: "full outfit (dress or matching set, head-to-toe garment)",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Baixa a foto da peça e devolve como data URL, o formato que o gateway aceita com certeza. */
async function garmentDataUrl(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`foto da peça indisponível (${r.status})`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > MAX_GARMENT_BYTES) throw new Error("foto da peça grande demais");
  const type = r.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return `data:${type};base64,${toBase64(bytes)}`;
}

/** O formato da imagem na resposta variou entre versões do gateway; aceita todos os conhecidos. */
// deno-lint-ignore no-explicit-any
function extractImage(data: any): string | null {
  const msg = data?.choices?.[0]?.message;
  const fromImages = msg?.images?.[0]?.image_url?.url ?? msg?.images?.[0]?.url;
  if (typeof fromImages === "string") return fromImages;
  if (Array.isArray(msg?.content)) {
    for (const part of msg.content) {
      const u = part?.image_url?.url ?? part?.image_url;
      if (typeof u === "string" && u.startsWith("data:image")) return u;
      if (part?.type === "image" && part?.data) {
        return `data:${part.mime_type ?? "image/png"};base64,${part.data}`;
      }
    }
  }
  if (typeof msg?.content === "string") {
    const m = msg.content.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/);
    if (m) return m[0];
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método não permitido" });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json(500, { error: "Provador indisponível no momento." });

    let body: { photo?: unknown; product_ids?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Requisição inválida." });
    }

    // ---- foto da cliente
    const photo = typeof body.photo === "string" ? body.photo : "";
    const photoMatch = photo.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!photoMatch) return json(400, { error: "Envie uma foto em JPG, PNG ou WEBP." });
    if ((photoMatch[2].length * 3) / 4 > MAX_PHOTO_BYTES) {
      return json(413, { error: "Foto muito grande. Tente uma foto menor." });
    }

    // ---- peças
    const ids = Array.isArray(body.product_ids) ? [...new Set(body.product_ids)] : [];
    if (
      ids.length < 1 || ids.length > 3 ||
      !ids.every((i) => typeof i === "string" && UUID.test(i))
    ) {
      return json(400, { error: "Escolha de 1 a 3 peças." });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: products, error: pErr } = await admin
      .from("products")
      .select("id, name, image_url, garment_type, active, is_draft")
      .in("id", ids as string[]);
    if (pErr) throw pErr;

    const garments = (products ?? []).filter((p) => p.active && !p.is_draft && p.image_url);
    if (garments.length !== ids.length) {
      return json(400, { error: "Uma das peças não está disponível para o provador." });
    }

    const regions = new Map<Region, (typeof garments)[number]>();
    for (const g of garments) {
      const region = REGION[g.garment_type ?? ""];
      if (!region) return json(400, { error: `"${g.name}" não pode ser usada no provador.` });
      if (regions.has(region)) {
        return json(400, { error: "Escolha só uma peça para cada parte do corpo." });
      }
      regions.set(region, g);
    }
    if (regions.has("full") && regions.size > 1) {
      return json(400, { error: "Vestido e conjunto já vestem o corpo todo: use sem outra peça." });
    }

    // ---- limite de uso. Registrado antes da IA: tentativa que falha também conta,
    // senão quem força erro repetido gasta créditos sem nunca bater no limite.
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      req.headers.get("cf-connecting-ip") || "desconhecido";
    const clientKey = await sha256(`jmk-provador:${ip}`);
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const dayAgo = new Date(Date.now() - 86400_000).toISOString();

    const [{ count: mine }, { count: all }] = await Promise.all([
      admin.from("store_tryon_usage").select("id", { count: "exact", head: true })
        .eq("client_key", clientKey).gte("created_at", hourAgo),
      admin.from("store_tryon_usage").select("id", { count: "exact", head: true })
        .gte("created_at", dayAgo),
    ]);
    if ((mine ?? 0) >= PER_CLIENT_PER_HOUR) {
      return json(429, { error: "Você atingiu o limite de provas desta hora. Tente de novo mais tarde." });
    }
    if ((all ?? 0) >= GLOBAL_PER_DAY) {
      return json(429, { error: "O provador atingiu o limite de hoje. Volte amanhã!" });
    }
    await admin.from("store_tryon_usage").insert({ client_key: clientKey });

    // ---- monta o pedido para a IA
    const ordered = [...regions.entries()];
    const garmentImages = await Promise.all(ordered.map(([, g]) => garmentDataUrl(g.image_url!)));

    const wearList = ordered
      .map(([region, g], i) => `- Image ${i + 2} ("${g.name}"): the ${REGION_EN[region]}.`)
      .join("\n");

    const keepNote = regions.has("full")
      ? "Replace the person's entire outfit with the full outfit."
      : regions.has("upper") && !regions.has("lower")
      ? "Replace only the upper-body clothing; keep the person's current bottom garment unchanged."
      : regions.has("lower") && !regions.has("upper")
      ? "Replace only the lower-body clothing; keep the person's current top unchanged."
      : "Replace the top and the bottom with the garments given.";

    const prompt = [
      "Virtual try-on for a women's modest fashion store.",
      "Image 1 is a full-body photo of the customer.",
      "Dress the customer in the garments below, exactly as they appear in their product photos:",
      wearList,
      keepNote,
      "Preserve the customer's identity exactly: same face, hair, skin tone, body shape, proportions, pose, and the same background and lighting.",
      "Reproduce each garment faithfully: color, print, fabric texture, neckline, sleeve length, and hem length. Fit the clothes naturally to the body with realistic drape and folds.",
      "Keep the result modest and elegant. Do not add accessories, text, logos, or extra people. Photorealistic, full body in frame.",
      "Return only the edited image.",
    ].join("\n");

    const content = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: photo } },
      ...garmentImages.map((url) => ({ type: "image_url", image_url: { url } })),
    ];

    for (const model of MODELS) {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          modalities: ["image", "text"],
          messages: [{ role: "user", content }],
        }),
      });

      if (aiResp.status === 429) {
        return json(429, { error: "Muita gente usando o provador agora. Tente em alguns segundos." });
      }
      if (aiResp.status === 402) {
        console.error("store-try-on: créditos de IA esgotados");
        return json(503, { error: "Provador temporariamente indisponível." });
      }
      if (!aiResp.ok) {
        // Modelo inexistente nesta versão do gateway: tenta o próximo.
        console.error("store-try-on gateway", model, aiResp.status, (await aiResp.text()).slice(0, 300));
        continue;
      }

      const image = extractImage(await aiResp.json());
      if (image) return json(200, { ok: true, image, model });
      console.error("store-try-on", model, "resposta sem imagem");
    }

    return json(502, {
      error: "A IA não conseguiu montar o look com essa foto. Tente uma foto de corpo inteiro, de frente e bem iluminada.",
    });
  } catch (err) {
    console.error("store-try-on error", (err as Error).message);
    return json(500, { error: "Não foi possível gerar o provador agora." });
  }
});
