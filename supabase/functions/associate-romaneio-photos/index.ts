// @ts-nocheck
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM = `Você recebe imagens de páginas de um romaneio/catálogo de fornecedor de roupas.
Localize TODAS as fotos de produtos visíveis nas páginas e, para cada foto, informe o código/SKU impresso ao lado dela (o código base, ex.: "05705" mesmo se aparecer "05705.008").
Se uma lista de SKUs for fornecida, priorize esses códigos, mas NÃO se limite a ela: reporte toda foto cujo código consiga ler.
Não invente códigos. Se a foto não tiver código legível, omita.
As coordenadas do bounding box devem ser normalizadas (0.0 a 1.0) em relação à página e devem cobrir apenas a foto do produto.`;

const tool = {
  type: "function",
  function: {
    name: "associate_photos",
    description: "Associa fotos de produtos aos SKUs",
    parameters: {
      type: "object",
      properties: {
        associations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              page_index: { type: "number", description: "Índice 0-based da página" },
              bbox: {
                type: "object",
                properties: {
                  x: { type: "number", description: "0-1" },
                  y: { type: "number", description: "0-1" },
                  w: { type: "number", description: "0-1" },
                  h: { type: "number", description: "0-1" },
                },
                required: ["x", "y", "w", "h"],
              },
            },
            required: ["sku", "page_index", "bbox"],
          },
        },
      },
      required: ["associations"],
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let body: any = {};
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    const { pages, skus } = body;
    if (!Array.isArray(pages) || !pages.length) return json({ error: "pages required" }, 400);

    const skuHint = Array.isArray(skus) && skus.length
      ? `SKUs prioritários (mas não exclusivos):\n${skus.slice(0, 400).join(", ")}\n\n`
      : "";
    const content: any[] = [
      { type: "text", text: `${skuHint}Analise as ${pages.length} página(s) a seguir e retorne TODAS as fotos de produtos com seus códigos via tool call.` },
    ];
    for (const p of pages) {
      content.push({ type: "image_url", image_url: { url: p } });
    }

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "associate_photos" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI err", resp.status, t.slice(0, 300));
      if (resp.status === 429) return json({ error: "rate_limit" }, 429);
      if (resp.status === 402) return json({ error: "no_credits" }, 402);
      return json({ error: "ai_error" }, 500);
    }

    const j = await resp.json();
    const call = j.choices?.[0]?.message?.tool_calls?.[0];
    const rawArgs = call?.function?.arguments;
    if (!rawArgs) return json({ ok: true, associations: [] });
    let args: any = {};
    try {
      args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
    } catch (e) {
      console.error("failed to parse tool args", String(rawArgs).slice(0, 200));
      return json({ ok: true, associations: [] });
    }
    return json({ ok: true, associations: Array.isArray(args?.associations) ? args.associations : [] });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
