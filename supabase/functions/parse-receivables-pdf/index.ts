// @ts-nocheck
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `Você extrai lançamentos de contas a receber de extratos/relatórios bancários ou comerciais brasileiros (PDFs).

REGRAS CRÍTICAS:
1. Identifique CADA LANÇAMENTO/PARCELA pendente ou em aberto. NÃO PULE NENHUMA LINHA.
2. Processe o PDF INTEIRO - todas as páginas, do início ao fim. Se houver 200 lançamentos, retorne 200.
3. Para cada lançamento extraia:
   - customer_name: nome do cliente/sacado/pagador (texto). Se vier no formato "NOME - CPF/CNPJ", separe.
   - tax_id: CPF (11 dígitos) ou CNPJ (14 dígitos), apenas dígitos. Omita se não houver.
   - description: histórico/descrição/número do título. Curto (até 80 chars).
   - amount: valor em reais (use ponto decimal). Sempre positivo.
   - due_date: data de vencimento no formato ISO YYYY-MM-DD.
4. Ignore SOMENTE totalizadores, cabeçalhos, saldos, taxas e linhas sem cliente+valor+vencimento.
5. NUNCA invente dados. Se faltar vencimento OU valor, omita a linha.

Retorne via tool call.`;

const tool = {
  type: "function",
  function: {
    name: "extract_receivables",
    description: "Lista COMPLETA de contas a receber extraídas do PDF (todas as linhas, todas as páginas)",
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
        total_count: { type: "number", description: "Quantidade total de lançamentos identificados no PDF" },
        grand_total: { type: "number", description: "Soma total dos valores (R$) de todos os lançamentos" },
      },
      required: ["items"],
    },
  },
};

function dedupKey(it: any) {
  return [
    (it.customer_name || "").trim().toLowerCase(),
    Number(it.amount).toFixed(2),
    String(it.due_date || "").slice(0, 10),
    (it.description || "").trim().toLowerCase(),
  ].join("|");
}

async function extractPass(file_base64: string, filename: string, exclude: any[]): Promise<{ items: any[]; total_count?: number; grand_total?: number; finishReason?: string }> {
  const userText = exclude.length === 0
    ? "Extraia TODOS os lançamentos a receber deste PDF (todas as páginas, do início ao fim). Inclua também os campos total_count e grand_total com a contagem total e a soma total esperadas."
    : `Você já extraiu ${exclude.length} lançamentos anteriormente. Continue extraindo APENAS os lançamentos que ainda não foram retornados (do final da lista anterior em diante). NÃO repita lançamentos já extraídos. Os últimos extraídos foram:\n${exclude.slice(-10).map((e: any) => `- ${e.customer_name} | R$ ${e.amount} | ${e.due_date}`).join("\n")}\n\nRetorne os RESTANTES.`;

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
            { type: "text", text: userText },
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
    if (aiResp.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em alguns segundos.");
    if (aiResp.status === 402) throw new Error("Créditos esgotados na IA. Adicione créditos em Lovable AI.");
    throw new Error("AI error: " + errText.slice(0, 200));
  }

  const aiJson = await aiResp.json();
  const choice = aiJson.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  const finishReason = choice?.finish_reason;
  if (!toolCall) {
    console.error("No tool call", JSON.stringify(aiJson).slice(0, 500));
    throw new Error("IA não conseguiu extrair os dados");
  }
  let parsed: any = {};
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    // Tentar reparar JSON cortado
    const raw = toolCall.function.arguments || "";
    const lastBrace = raw.lastIndexOf("}");
    if (lastBrace > 0) {
      try {
        parsed = JSON.parse(raw.slice(0, lastBrace + 1) + "]}");
      } catch {
        parsed = { items: [] };
      }
    }
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return { items, total_count: parsed.total_count, grand_total: parsed.grand_total, finishReason };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { file_base64, filename } = await req.json();
    if (!file_base64 || typeof file_base64 !== "string") {
      return json({ error: "file_base64 required" }, 400);
    }

    const allItems: any[] = [];
    const seen = new Set<string>();
    let expectedTotal: number | undefined;
    let expectedGrand: number | undefined;
    const MAX_PASSES = 4;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const { items, total_count, grand_total, finishReason } = await extractPass(file_base64, filename, allItems);
      if (pass === 0) {
        expectedTotal = total_count;
        expectedGrand = grand_total;
      }
      let added = 0;
      for (const it of items) {
        const k = dedupKey(it);
        if (seen.has(k)) continue;
        seen.add(k);
        allItems.push(it);
        added++;
      }
      console.log(`Pass ${pass + 1}: received ${items.length}, added ${added}, total now ${allItems.length}, finish=${finishReason}, expected=${expectedTotal}`);

      // Parar se: nada novo foi adicionado, OU bateu/ultrapassou expectedTotal, OU finish_reason normal e nenhum item retornado
      if (added === 0) break;
      if (expectedTotal && allItems.length >= expectedTotal) break;
      // Se o modelo terminou normalmente E retornou poucos itens novos, provavelmente acabou
      if (finishReason === "stop" && added < 5 && pass > 0) break;
    }

    const sum = allItems.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    console.log(`FINAL: ${allItems.length} items, sum R$ ${sum.toFixed(2)}, expected count ${expectedTotal}, expected sum ${expectedGrand}`);

    return json({
      ok: true,
      items: allItems,
      meta: {
        extracted_count: allItems.length,
        extracted_sum: Number(sum.toFixed(2)),
        expected_count: expectedTotal ?? null,
        expected_sum: expectedGrand ?? null,
      },
    });
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
