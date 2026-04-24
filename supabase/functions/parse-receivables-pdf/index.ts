// @ts-nocheck
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `Você extrai lançamentos de contas a receber de extratos/relatórios bancários ou comerciais brasileiros (PDFs).

REGRAS:
1. Identifique CADA LANÇAMENTO/PARCELA pendente ou em aberto.
2. Para cada um extraia:
   - customer_name: nome do cliente/sacado/pagador (texto). Se vier no formato "NOME - CPF/CNPJ", separe.
   - tax_id: CPF (11 dígitos) ou CNPJ (14 dígitos), apenas dígitos. Omita se não houver.
   - description: histórico/descrição/número do título. Curto (até 80 chars).
   - amount: valor em reais (use ponto decimal). Sempre positivo.
   - due_date: data de vencimento no formato ISO YYYY-MM-DD.
3. Ignore totalizadores, cabeçalhos, saldos, taxas e linhas sem cliente+valor+vencimento.
4. NUNCA invente dados. Se faltar vencimento OU valor, omita a linha.

Retorne via tool call.`;

const tool = {
  type: "function",
  function: {
    name: "extract_receivables",
    description: "Lista de contas a receber extraídas do PDF",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              customer_name: { type: "string" },
              tax_id: { type: "string" },
              description: { type: "string" },
              amount: { type: "number" },
              due_date: { type: "string", description: "ISO YYYY-MM-DD" },
            },
            required: ["customer_name", "amount", "due_date"],
          },
        },
      },
      required: ["items"],
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { file_base64, filename } = await req.json();
    if (!file_base64 || typeof file_base64 !== "string") {
      return json({ error: "file_base64 required" }, 400);
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Extraia todos os lançamentos a receber deste PDF." },
              {
                type: "file",
                file: {
                  filename: filename || "extrato.pdf",
                  file_data: `data:application/pdf;base64,${file_base64}`,
                },
              },
            ],
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "extract_receivables" } },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI gateway error", aiResp.status, errText);
      if (aiResp.status === 429) return json({ error: "Limite de requisições atingido. Tente novamente em alguns segundos." }, 429);
      if (aiResp.status === 402) return json({ error: "Créditos esgotados na IA. Adicione créditos em Lovable AI." }, 402);
      return json({ error: "AI error: " + errText.slice(0, 200) }, 500);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call", JSON.stringify(aiJson).slice(0, 500));
      return json({ error: "IA não conseguiu extrair os dados" }, 422);
    }

    const extracted = JSON.parse(toolCall.function.arguments);
    const items = Array.isArray(extracted.items) ? extracted.items : [];
    return json({ ok: true, items });
  } catch (e) {
    console.error("parse-receivables-pdf error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
