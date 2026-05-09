// Edge function: scan-label
// Recebe imagem (base64 data url) de etiqueta e usa Lovable AI Gemini Vision
// para extrair fornecedor, código, descrição, cor, tamanho, etc.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Você é um especialista em ler etiquetas de roupas brasileiras (impressas, térmicas, manuscritas, com baixa qualidade ou inclinadas).

Extraia da imagem TODOS os dados visíveis e retorne APENAS um JSON com este formato:
{
  "supplier": string|null,
  "code": string|null,
  "description": string|null,
  "color": string|null,
  "size": string|null,
  "barcode": string|null,
  "reference": string|null,
  "category": string|null,
  "brand": string|null,
  "suggested_price": number|null,
  "confidence": number entre 0 e 1
}

Regras:
- Normalize tamanhos: PP, P, M, G, GG, XG, XGG, ou números (34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56), ou "Único".
- Expanda abreviações de cor: PT=Preto, BR=Branco, AZ=Azul, AZM=Azul Marinho, ROS=Rosa, VM=Vermelho, VD=Verde, AM=Amarelo, BG=Bege, MR=Marrom, CZ=Cinza, LJ=Laranja, RX=Roxo, NU=Nude, OFF=Off-white.
- Corrija erros óbvios de OCR (0 vs O, 1 vs I, etc).
- Se não souber um campo, use null. Não invente.
- Preço: extraia apenas se aparecer claramente "R$" ou "PREÇO" na etiqueta.
- Confidence: 0.9+ se etiqueta clara, 0.5-0.8 se parcial, <0.5 se muito ruim.

Responda APENAS o JSON, sem markdown, sem explicações.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image } = await req.json();
    if (!image || typeof image !== "string") {
      return new Response(
        JSON.stringify({ error: "image (base64 data url) é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY ausente" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Leia esta etiqueta e devolva o JSON." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("AI gateway error", aiResp.status, txt);
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de uso atingido. Tente em alguns segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos esgotados. Adicione créditos em Configurações." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "Falha na IA", detail: txt }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const content = aiData?.choices?.[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    }

    return new Response(JSON.stringify({ ok: true, data: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("scan-label error", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
