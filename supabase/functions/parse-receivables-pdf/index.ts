// @ts-nocheck
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `Você extrai lançamentos de contas a receber de extratos/relatórios bancários ou comerciais brasileiros (PDFs).

REGRAS CRÍTICAS:
1. Identifique CADA LANÇAMENTO/PARCELA pendente ou em aberto. NÃO PULE NENHUMA LINHA.
2. Processe o PDF INTEIRO - todas as páginas, do início ao fim.
3. Para cada lançamento extraia:
   - customer_name: nome do cliente/sacado/pagador. Se vier "NOME - CPF/CNPJ", separe.
   - tax_id: CPF (11 dígitos) ou CNPJ (14 dígitos), apenas dígitos. Use "" se não houver.
   - description: histórico/descrição/título. Curto (até 80 chars). Use "" se não houver.
   - amount: valor em reais (número, ponto decimal). Sempre positivo.
   - due_date: vencimento ISO YYYY-MM-DD.
4. Ignore totalizadores, cabeçalhos, saldos, taxas e linhas sem cliente+valor+vencimento.
5. NUNCA invente. Se faltar vencimento OU valor, omita a linha.

RETORNE APENAS JSON VÁLIDO no formato:
{"items":[{"customer_name":"...","tax_id":"","description":"...","amount":0.00,"due_date":"YYYY-MM-DD"}],"total_count":N,"grand_total":N.NN}

Nada fora do JSON. Sem markdown, sem comentários.`;

function dedupKey(it: any) {
  return [
    (it.customer_name || "").trim().toLowerCase(),
    Number(it.amount).toFixed(2),
    String(it.due_date || "").slice(0, 10),
    (it.description || "").trim().toLowerCase(),
  ].join("|");
}

function extractJSON(raw: string): any {
  let cleaned = (raw || "")
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/```\s*$/im, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON object in response");
  cleaned = cleaned.slice(start);

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Try to repair truncated JSON: cut at last complete item
  const lastClose = cleaned.lastIndexOf("}");
  if (lastClose > 0) {
    // Find the items array, then close it
    const itemsIdx = cleaned.indexOf('"items"');
    if (itemsIdx !== -1) {
      const arrStart = cleaned.indexOf("[", itemsIdx);
      if (arrStart !== -1) {
        // Walk back from end to find last valid }
        let candidate = cleaned.slice(0, lastClose + 1);
        // Append closing for array+object if needed
        for (const tail of ["", "]}", "}]}"]) {
          try {
            return JSON.parse(candidate + tail);
          } catch {}
        }
      }
    }
  }
  throw new Error("Cannot parse JSON");
}

async function extractPass(file_base64: string, filename: string, exclude: any[]): Promise<{ items: any[]; total_count?: number; grand_total?: number; finishReason?: string }> {
  const userText = exclude.length === 0
    ? "Extraia TODOS os lançamentos a receber deste PDF (todas as páginas). Inclua total_count e grand_total."
    : `Já extraí ${exclude.length} lançamentos. Continue do ponto onde parou. NÃO repita. Últimos extraídos:\n${exclude.slice(-8).map((e: any) => `- ${e.customer_name} | R$ ${e.amount} | ${e.due_date}`).join("\n")}\n\nRetorne APENAS os RESTANTES no mesmo formato JSON.`;

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: 16000,
      response_format: { type: "json_object" },
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
  const finishReason = choice?.finish_reason;
  const content = choice?.message?.content;

  if (!content) {
    console.error("No content", JSON.stringify(aiJson).slice(0, 800));
    throw new Error("IA não retornou conteúdo");
  }

  let parsed: any = {};
  try {
    parsed = extractJSON(content);
  } catch (e) {
    console.error("Parse failed. Content head:", content.slice(0, 400));
    throw new Error("IA não conseguiu extrair os dados (JSON inválido)");
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
    const MAX_PASSES = 2;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let passResult;
      try {
        passResult = await extractPass(file_base64, filename, allItems);
      } catch (e) {
        // Se a primeira tentativa falhar totalmente, propaga; se for continuação, apenas para
        if (pass === 0) throw e;
        console.warn("Continuation pass failed, stopping:", (e as Error).message);
        break;
      }
      const { items, total_count, grand_total, finishReason } = passResult;
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
      console.log(`Pass ${pass + 1}: received ${items.length}, added ${added}, total ${allItems.length}, finish=${finishReason}, expected=${expectedTotal}`);

      if (added === 0) break;
      if (expectedTotal && allItems.length >= expectedTotal) break;
      if (finishReason === "stop" && pass > 0) break;
    }

    const sum = allItems.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    console.log(`FINAL: ${allItems.length} items, sum R$ ${sum.toFixed(2)}, expected ${expectedTotal} / R$ ${expectedGrand}`);

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
